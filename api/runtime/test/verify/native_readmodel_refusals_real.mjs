// Every refused daemon read model names its own reason; workspace.status stays served.
// <addon> <parent> <host> <WinFsp> <resident> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
import {LayerFSBackend} from '@layerfs/backend';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,8);
const [addon,executable,host,winfsp,restrictedLauncher,out]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),paths={addon,executable,host,winfsp,restrictedLauncher};const identity=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(p)]));
const save=(n,v)=>writeFileSync(join(out,n),JSON.stringify(v,null,2));
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'read models\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('read-model-refusals',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('read-model-refusals');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'read-model-refusals',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});
 const reg=await runtime.native.bindClient(shop,instance,{commitScope:'published'});
 const ws=await shop.workspace.mount(reg.sandbox,'feature');const ref={sandbox:reg.sandbox,path:ws.path};
 const backend=LayerFSBackend.of(shop);
 const calls=[['get_storage',()=>backend.daemon.workspace.get_storage(ref)],['list_changes',()=>backend.daemon.workspace.list_changes(ref)],['process.start',()=>backend.daemon.process.start(ref,{mode:'windows-native',executable:'cmd.exe',args:['/c','echo']})],['process.list',()=>backend.daemon.process.list()],['process.cancel',()=>backend.daemon.process.cancel('proc_1_ff')],['sandbox.get_log',()=>backend.daemon.sandbox.get_log(reg.sandbox,{lines:10})]];
 const messages=new Map();
 for(const [label,call] of calls){const e=await call().then(()=>null,e=>e);assert.ok(e,label+' must refuse');assert.equal(e.code,'Unsupported',label+': '+String(e.message));messages.set(label,String(e.message));}
 assert.equal(new Set(messages.values()).size,4,'four refusal reasons: storage, changes, process family, sandbox log');
 assert.match(messages.get('get_storage'),/overlay/);assert.match(messages.get('list_changes'),/scan|changes/);
 for(const label of ['process.start','process.list','process.cancel'])assert.match(messages.get(label),/background processes/);
 assert.match(messages.get('sandbox.get_log'),/daemon log/);
 const status=await backend.daemon.workspace.status(ref);assert.equal(status.branch,'feature');assert.equal(status.activity,'Idle');
 steps.push({label:'read-model-refusals',refused:Object.fromEntries([...messages].map(([k,v])=>[k,v.slice(0,60)])),distinct:new Set(messages.values()).size,status:status.activity});
 await shop.workspace.unmount(ref,true);const closed=await instance.close();assert.equal(closed.processExit,0);
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS every refused daemon read model names its own reason; workspace.status stays served');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped read-model refusals',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
