// Explicit Windows Git roundtrip; selected routes never fall back after failure.
// Default trusted-local; LAYERFS_TEST_GIT_ROUNDTRIP_MODE=restricted-sdk requires
// LAYERFS_TEST_RESTRICTED_LAUNCHER and consumes one original resident via the SDK.
// <addon> <parent> <host> <WinFsp> <git.exe> <closed-prepared-source> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
import {LayerFSBackend} from '@layerfs/backend';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,9);
const [addon,executable,host,winfsp,git,prepared,out]=process.argv.slice(2).map(p=>resolve(p));
assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const mode=process.env.LAYERFS_TEST_GIT_ROUNDTRIP_MODE??'trusted-local';assert.ok(['trusted-local','restricted-sdk'].includes(mode));const restricted=mode==='restricted-sdk';
const restrictedLauncher=restricted?resolve(process.env.LAYERFS_TEST_RESTRICTED_LAUNCHER??''):null;if(restricted)assert.ok(process.env.LAYERFS_TEST_RESTRICTED_LAUNCHER,'explicit original resident launcher required');
const paths={addon,executable,host,winfsp,git,...(restricted?{restrictedLauncher}:{})};const identity=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(readFileSync(p))]));
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2));
function manifest(root,dir=root){
 const rows=[];
 for(const name of readdirSync(dir).sort()){
  const p=join(dir,name),s=lstatSync(p),path=relative(root,p).replaceAll('\\','/');
  if(s.isDirectory()){rows.push({path,kind:'directory'});rows.push(...manifest(root,p));}
  else {assert.ok(s.isFile());const bytes=readFileSync(p);rows.push({path,kind:'file',bytes:bytes.length,sha256:hash(bytes)});}
 }
 return rows;
}
const original=manifest(prepared);assert.ok(original.some(r=>r.path==='repo/.git/index'));save('prepared-before.json',original);
const source=join(out,'source'),home=join(out,'home');cpSync(prepared,source,{recursive:true,errorOnExist:true,force:false});assert.deepEqual(manifest(source),original);mkdirSync(home);
const seedCommit=readFileSync(join(source,'repo/.git/refs/heads/main'),'utf8').trim();assert.match(seedCommit,/^[0-9a-f]{40}$/);
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);save('home-acl.json',{exit:acl.status,stdout:acl.stdout,stderr:acl.stderr});
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;process.env.LAYERFS_TRACE=join(out,'sdk-trace.jsonl');
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,backend,instance,registration,residentPID,failure=null,phase='init',sequence=0,mountSequence=0;const commands=[],publications=[],terminals=[],observations=[],resident=[];
const checkpoints={indexWorkingSaved:false,firstPublication:false,firstTerminal:false,firstRemountExact:false,secondPublication:false,secondTerminal:false,secondRemountExact:false,thirdTerminal:false,runtimeClosed:false};
const collect=async stream=>{const parts=[];for await(const b of stream)parts.push(b);return Buffer.concat(parts);};
const gitEnv=s=>({GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(s.path,'git-settings/empty-config'),GIT_CONFIG_SYSTEM:join(s.path,'git-settings/empty-config'),GIT_TEMPLATE_DIR:join(s.path,'git-settings/template'),GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Native Roundtrip Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Native Roundtrip Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',GIT_AUTHOR_DATE:'2026-11-03T00:00:00+08:00',GIT_COMMITTER_DATE:'2026-11-03T00:00:00+08:00'});
async function run(s,args){
 const id=String(++sequence).padStart(2,'0'),argv=['--no-optional-locks','-c','core.autocrlf=false','-c','commit.gpgsign=false','-C',join(s.path,'repo'),...args];
 const entry={id,phase,args:argv,read_at:new Date().toISOString()};save('progress.json',entry);
 try{
  const child=restricted?await shop.workspace.exec(s,{mode:'windows-native',executable:git,args:argv,env:gitEnv(s)}):await s.exec(git,argv,{env:gitEnv(s)});const streams=Promise.all([collect(child.stdout),collect(child.stderr)]);child.stdin.end();entry.root=await child.exited;entry.finished=await child.finished;const [stdout,stderr]=await streams;
  Object.assign(entry,{command:child.id,pid:child.pid,restricted:child.restricted,stdoutBytes:stdout.length,stdoutSha256:hash(stdout),stderrBytes:stderr.length});writeFileSync(join(out,id+'-stdout.bin'),stdout);writeFileSync(join(out,id+'-stderr.bin'),stderr);commands.push(entry);save(id+'.json',entry);
  assert.equal(child.restricted,restricted);assert.equal(entry.finished.restricted,restricted);assert.deepEqual(entry.root,{exitCode:0,signal:null},stderr.toString());assert.equal(entry.finished.exitCode,0);return stdout.toString('utf8');
 }catch(e){save(id+'-failure.json',{...entry,error:{code:e.code??null,message:e.message}});throw e;}
}
async function mount(){const n=++mountSequence;if(restricted){const original=await instance.status();assert.equal(original.pid,residentPID);const ws=await shop.workspace.mount(registration.sandbox,'feature');assert.equal(ws.mode,'windows-restricted');assert.equal(resolve(ws.path),resolve(join(out,'layerfs-'+instance.id+'-'+n+'-mount')));const owner=(await runtime.native.list()).find(row=>row.path===ws.path);assert.ok(owner);assert.equal(owner.instance,instance.id);assert.equal(owner.restricted,true);resident.push({label:'mount-'+n,original,workspace:owner.id,path:ws.path});return ws;}return runtime.native.open({project:'git-roundtrip',branch:'feature',executable,host,winfsp,work:join(out,n+'-work'),path:join(out,n+'-mount')});}
async function state(s){if(!restricted)return s.state();const value=await backend.daemon.workspace.status(s);assert.equal(value.mode,'windows-restricted');const owner=(await runtime.native.list()).find(row=>row.path===s.path);assert.ok(owner);assert.equal(owner.instance,instance.id);assert.equal(value.workspace,owner.id);assert.equal(value.native.workspace,owner.id);return value.native;}
async function publish(s){if(!restricted)return s.commit('published',true);const receipt=await shop.workspace.commit(s);assert.equal(receipt.kind,'Committed');assert.equal(receipt.mode,'windows-restricted');return receipt;}
async function references(s){
 const rows=[];let after=0n;
 for(let n=0;n<128;n++){
  const first=await s.reference(after);if(!first.found)return rows;let row=first;const chunks=[first.path];
  while(row.nextOffset!==null){row=await s.reference(after,row.nextOffset);assert.equal(row.found,true);for(const k of ['handle','serial','file','directory','lookup','cleaned','dataWritable','attributesWritable','deleteAccess','pathBytes'])assert.equal(row[k],first[k]);chunks.push(row.path);}
  rows.push({...first,path:Buffer.concat(chunks).toString('utf8')});after=first.handle;
 }
 throw Error('fixture reference observation exceeds budget');
}
async function close(s,label){
 phase=label;const observed=await state(s),rows=restricted?null:await references(s);observations.push({label,read_at:new Date().toISOString(),state:observed,rows,scope:restricted?'original SDK native state; no reference-list API':'original direct Session reference windows'});save('close-observations.json',observations);
 // No zero-handle preflight or test-side drain wait: the original owner admits
 // and completes this one explicit clean unmount, or preserves its refusal.
 const receipt=restricted?await shop.workspace.unmount(s):await s.unmount(false);if(restricted){assert.equal(receipt.kind,'Unmounted');assert.equal(receipt.mode,'windows-restricted');}assert.equal(receipt.nativeExit,0);assert.equal(receipt.processExit,0);assert.equal(receipt.overlayClosed,true);assert.equal(receipt.processSignal,null);assert.equal(existsSync(s.path),false);terminals.push({label,...receipt});save('terminals.json',terminals);
}
try{
 let init=await runtime.project.start_init('git-roundtrip',source,{timeout:20000});const deadline=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<deadline);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global','store.sqlite');shop=await LayerFS.open('git-roundtrip');await shop.branch.fork('feature');assert.equal((await shop.branch.list_commits('feature')).items.length,0);
 if(restricted){instance=await runtime.native.create({project:'git-roundtrip',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});registration=await runtime.native.bindClient(shop,instance,{commitScope:'published'});backend=LayerFSBackend.of(shop);const original=await instance.status();residentPID=original.pid;resident.push({label:'created',original,instance:instance.id,registration});}
 const a=await mount(),repo=join(a.path,'repo'),binary=Buffer.from(Uint8Array.from({length:300023},(_,i)=>(i*19+5)%251));phase='first-working-state';
 writeFileSync(join(repo,'.gitignore'),'ignored/\n');mkdirSync(join(repo,'ignored'));writeFileSync(join(repo,'ignored/cache.bin'),binary);writeFileSync(join(repo,'staged.txt'),'staged index content\n');await run(a,['add','.gitignore','staged.txt']);writeFileSync(join(repo,'staged.txt'),'unstaged working content\n');writeFileSync(join(repo,'untracked.txt'),'untracked complete workspace\n');
 const porcelain=await run(a,['status','--porcelain']);assert.equal(porcelain,'A  .gitignore\nAM staged.txt\n?? untracked.txt\n');assert.equal(await run(a,['show',':staged.txt']),'staged index content\n');assert.equal((await run(a,['check-ignore','ignored/cache.bin'])).trim(),'ignored/cache.bin');assert.equal(await run(a,['show','HEAD:seed.txt']),'minimal Git history payload\n');
 const beforeFirst=manifest(a.path);save('before-first.json',beforeFirst);assert.ok(beforeFirst.some(r=>r.path==='repo/.git/index'));assert.ok(beforeFirst.some(r=>r.path==='repo/ignored/cache.bin'));checkpoints.indexWorkingSaved=true;await assert.rejects(shop.fs.read('feature','/repo/staged.txt'),{code:'NoSuchPath'});
 phase='first-publication';const pub1=await publish(a);assert.equal(pub1.changed,true);assert.equal(pub1.parent,null);publications.push(pub1);checkpoints.firstPublication=true;save('publications.json',publications);await close(a,'first-clean-unmount');checkpoints.firstTerminal=true;
 phase='first-remount';const b=await mount(),afterFirst=manifest(b.path);save('after-first.json',afterFirst);assert.deepEqual(afterFirst,beforeFirst);checkpoints.firstRemountExact=true;assert.equal((await shop.fs.read('feature','/repo/staged.txt')).text,'unstaged working content\n');assert.equal((await shop.fs.stat('feature','/repo/ignored/cache.bin')).size,binary.length);assert.equal(await run(b,['status','--porcelain']),porcelain);assert.equal(await run(b,['show',':staged.txt']),'staged index content\n');
 phase='second-git-state';await run(b,['add','-A']);await run(b,['commit','-m','roundtrip second']);const secondCommit=(await run(b,['rev-parse','HEAD'])).trim();assert.match(secondCommit,/^[0-9a-f]{40}$/);assert.notEqual(secondCommit,seedCommit);assert.equal((await run(b,['rev-parse','HEAD^'])).trim(),seedCommit);assert.equal(await run(b,['status','--porcelain']),'');assert.equal(await run(b,['show','HEAD:staged.txt']),'unstaged working content\n');
 const beforeSecond=manifest(b.path);save('before-second.json',beforeSecond);phase='second-publication';const pub2=await publish(b);assert.equal(pub2.changed,true);assert.equal(pub2.parent,pub1.head);publications.push(pub2);checkpoints.secondPublication=true;save('publications.json',publications);const history=await shop.branch.list_commits('feature');assert.equal(history.items.length,2);assert.deepEqual(new Set(history.items.map(r=>r.id)),new Set(publications.map(r=>r.head)));save('history.json',history);await close(b,'second-clean-unmount');checkpoints.secondTerminal=true;
 phase='second-remount';const c=await mount(),afterSecond=manifest(c.path);save('after-second.json',afterSecond);assert.deepEqual(afterSecond,beforeSecond);checkpoints.secondRemountExact=true;assert.deepEqual(readFileSync(join(c.path,'repo/ignored/cache.bin')),binary);assert.equal(await run(c,['show','HEAD:staged.txt']),'unstaged working content\n');assert.equal(await run(c,['show',':staged.txt']),'unstaged working content\n');assert.equal(await run(c,['status','--porcelain']),'');const clean=await state(c);assert.equal(clean.dirtyInodes,0n);assert.equal(clean.dirtyEntries,0n);await close(c,'third-clean-unmount');checkpoints.thirdTerminal=true;
 assert.deepEqual(await runtime.native.list(),[]);if(restricted){assert.equal((await shop.sandbox.list_workspaces(registration.sandbox)).items.length,0);const original=await instance.status();assert.equal(original.pid,residentPID);resident.push({label:'before-close',original});const terminal=await shop.sandbox.close(registration.sandbox);assert.equal(terminal.tokenClosed,true);assert.equal(terminal.desktopClosed,true);assert.equal(terminal.processExit,0);assert.equal(terminal.processSignal,null);resident.push({label:'original-instance-terminal',...terminal});save('resident.json',resident);}assert.deepEqual(await runtime.native.instances(),[]);await shop.close();shop=undefined;await runtime.close();checkpoints.runtimeClosed=true;assert.deepEqual(manifest(prepared),original);save('prepared-after.json',manifest(prepared));for(const[k,p]of Object.entries(paths))assert.equal(hash(readFileSync(p)),identity[k]);save('observations.json',{seedCommit,secondCommit,ignoredBytes:binary.length,firstManifest:beforeFirst.length,secondManifest:beforeSecond.length,mountedGitCommands:commands.length,publications:2,remounts:2,terminals:3,unmountAttempts:3,testSideHandleDrainWait:false});phase='complete';console.log('PASS '+mode+' Git: index/working/ignored bytes, two publications/remounts and three original normal unmounts');
}catch(e){failure={phase,code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped '+mode+' Git roundtrip',read_at:new Date().toISOString(),phase,identity,prepared,preparedUnchanged:failure?null:true,failure,checkpoints,commands,publications,terminals,observations,mode,resident,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),instances:runtime.closed?[]:await runtime.native.instances(),restrictedGitQualified:restricted&&!failure,oldFailureUnchanged:true});}
