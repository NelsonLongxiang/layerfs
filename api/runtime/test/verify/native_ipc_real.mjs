// Public SDK consumer and independent Win32 observer for native IPC creation.
// <addon> <parent> <host> <WinFsp> <resident> <ipc-probe> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
import {LayerFSBackend} from '@layerfs/backend';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,9);
const [addon,executable,host,winfsp,restrictedLauncher,probe,out]=process.argv.slice(2).map(p=>resolve(p));
assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const paths={addon,executable,host,winfsp,restrictedLauncher,probe,node:process.execPath};
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const identity=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(p)]));
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'native IPC stage observation\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});
assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);writeFileSync(join(out,'acl.json'),JSON.stringify({exit:acl.status,stdout:acl.stdout,stderr:acl.stderr},null,2));
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;process.env.LAYERFS_TRACE=join(out,'sdk-trace.jsonl');
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const events=[];
const collect=async s=>{const chunks=[];for await(const b of s)chunks.push(b);return Buffer.concat(chunks);};
async function execute(ws,selection,name){
  const child=await shop.workspace.exec(ws,selection);const output=Promise.all([collect(child.stdout),collect(child.stderr)]);child.stdin.end();
  const root=await child.exited,finished=await child.finished;const [stdout,stderr]=await output;
  writeFileSync(join(out,name+'-stdout.txt'),stdout);writeFileSync(join(out,name+'-stderr.txt'),stderr);
  const value={name,id:child.id,pid:child.pid,root,finished,stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8')};events.push(value);return value;
}
try{
  let init=await runtime.project.start_init('ipc-project',source,{timeout:20000});const until=Date.now()+25000;
  while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}
  assert.equal(init.step,'done',JSON.stringify(init.error));writeFileSync(join(out,'init.json'),JSON.stringify(init,null,2));
  process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global','store.sqlite');shop=await LayerFS.open('ipc-project');await shop.branch.fork('feature');
  const instance=await runtime.native.create({project:'ipc-project',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});
  const resident=(await instance.status()).pid;const registered=await runtime.native.bindClient(shop,instance,{commitScope:'published'});const ws=await shop.workspace.mount(registered.sandbox,'feature');
  const observed=await execute(ws,{mode:'windows-native',executable:probe,args:[]},'win32');assert.equal(observed.root.exitCode,7);assert.equal(observed.stderr,'');assert.match(observed.stdout,/IPC_TOKEN restricted=1 integrity=4096/);
  assert.match(observed.stdout,/IPC_STAGE api=CreateIoCompletionPort_loop ok=1 win32=0/);assert.match(observed.stdout,/IPC_STAGE api=CreateNamedPipeA_server ok=1 win32=0/);assert.match(observed.stdout,/IPC_STAGE api=CreateFileA_client ok=0 win32=5/);
  assert.match(observed.stdout,/IPC_SECURITY flags=5 query=0/);assert.match(observed.stdout,/IPC_SECURITY flags=16 query=0/);assert.match(observed.stdout,/IPC_DESCRIPTOR S:\(ML;;NW;;;LW\)/);
  const policy=/IPC_TOKEN_DEFAULT .*\(A;;GA;;;(S-1-5-21-[0-9-]+)\)/.exec(observed.stdout)?.[1];assert.ok(policy);const pipeDescriptor=observed.stdout.split('\n').find(line=>line.startsWith('IPC_DESCRIPTOR O:'));assert.ok(pipeDescriptor);assert.equal(pipeDescriptor.includes(policy),false,'default token policy is not granted on the actual pipe');assert.match(pipeDescriptor,/\(A;;FR;;;WD\)/);
  const script="const fs=require('node:fs'),{spawn}=require('node:child_process');const emit=v=>process.stdout.write(JSON.stringify(v)+'\\n');emit({event:'cwd',cwd:process.cwd(),directory:fs.statSync(process.cwd()).isDirectory()});let c;try{c=spawn(process.execPath,['-e',\"process.once('message',m=>{process.send({answer:m.value+1});process.disconnect()})\"],{detached:true,stdio:[0,1,2,'ipc']})}catch(e){emit({event:'ipc-refused',phase:'spawn-call',code:e.code,errno:e.errno,syscall:e.syscall});process.exitCode=19}if(c){const timer=setTimeout(()=>{emit({event:'deadline'});process.exitCode=90},5000);c.once('error',e=>{clearTimeout(timer);emit({event:'ipc-refused',phase:'spawn-event',code:e.code,errno:e.errno,syscall:e.syscall});process.exitCode=19});c.once('spawn',()=>c.send({value:41}));c.once('message',m=>emit({event:'ipc-message',...m}));c.once('close',(code,signal)=>{clearTimeout(timer);emit({event:'child-close',code,signal})})}";
  const node=await execute(ws,{mode:'windows-native',executable:process.execPath,args:['-e',script]},'node');assert.equal(node.root.exitCode,19);assert.equal(node.stderr,'');const observations=node.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(observations,[{event:'cwd',cwd:ws.path,directory:true},{event:'ipc-refused',phase:'spawn-call',code:'EPERM',errno:-4048,syscall:'spawn'}]);
  const ordinaryScript="const fs=require('node:fs'),{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"require('node:fs').writeFileSync('after-ipc.txt','ordinary descendant after IPC refusal');process.stdout.write('ordinary-child');process.exitCode=6\"],{stdio:[0,1,2]});c.once('error',()=>process.exit(91));c.once('close',(code,signal)=>{if(signal)process.exit(92);process.exitCode=code})";
  const ordinary=await execute(ws,{mode:'windows-native',executable:process.execPath,args:['-e',ordinaryScript]},'ordinary');assert.equal(ordinary.root.exitCode,6);assert.equal(ordinary.stdout,'ordinary-child');assert.equal(ordinary.stderr,'');assert.equal(readFileSync(join(ws.path,'after-ipc.txt'),'utf8'),'ordinary descendant after IPC refusal');
  assert.equal((await instance.status()).pid,resident);assert.equal((await runtime.native.list())[0].commands,0);assert.equal((await shop.branch.list_commits('feature')).items.length,0);await assert.rejects(shop.fs.read('feature','/after-ipc.txt'),{code:'NoSuchPath'});const publication=await shop.workspace.commit(ws);assert.equal(publication.kind,'Committed');assert.equal((await shop.fs.read('feature','/after-ipc.txt')).text,'ordinary descendant after IPC refusal');assert.equal((await shop.branch.list_commits('feature')).items.length,1);events.push({name:'explicit-publication',head:publication.head,noAutomaticCommit:true,residentUnchanged:true});
  const backend=LayerFSBackend.of(shop),end=Date.now()+8000;for(;;){const s=await backend.daemon.workspace.status(ws);if(s.native.handles===0n&&s.native.active===0n)break;assert.ok(Date.now()<end);await new Promise(ok=>setTimeout(ok,20));}
  await shop.workspace.unmount(ws);const closed=await shop.sandbox.close(registered.sandbox);assert.equal(closed.tokenClosed,true);assert.equal(closed.desktopClosed,true);assert.equal(closed.processExit,0);events.push({name:'terminal',...closed});await shop.close();shop=undefined;await runtime.close();
  for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);console.log('PASS native IPC denial boundary: exact Win32 client error5, Node pre-spawn EPERM, ordinary descendant after refusal and original terminal');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS observed denial, not IPC support',read_at:new Date().toISOString(),identity,failure,events,runtime_closed:runtime.closed,instances:runtime.closed?[]:await runtime.native.instances(),sessions:runtime.closed?[]:await runtime.native.list()},(_,v)=>typeof v==='bigint'?v.toString():v,2));}
