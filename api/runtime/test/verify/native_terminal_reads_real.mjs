// Read models after terminal instance states: closed refuses/empties, retained refuses Unknown.
// <addon> <parent> <host> <WinFsp> <resident> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,8);
const [addon,executable,host,winfsp,restrictedLauncher,out]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),paths={addon,executable,host,winfsp,restrictedLauncher};const identity=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(p)]));
const save=(n,v)=>writeFileSync(join(out,n),JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2));
const kill=pid=>{const r=spawnSync('taskkill',['/PID',String(pid),'/F'],{encoding:'utf8',timeout:10000});return r.status;};
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'terminal read models\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shopA,shopB,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('terminal-reads',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shopA=await LayerFS.open('terminal-reads');shopB=await LayerFS.open('terminal-reads');await shopA.branch.fork('feature');
 // A closed instance refuses its read models and lists no Sandbox.
 const closedInstance=await runtime.native.create({project:'terminal-reads',executable,host,winfsp,restrictedLauncher,work:join(out,'closed-instance')});
 const closedReg=await runtime.native.bindClient(shopA,closedInstance,{commitScope:'published'});
 const closedWs=await shopA.workspace.mount(closedReg.sandbox,'feature');await shopA.workspace.unmount(closedWs,true);
 const closed=await closedInstance.close();assert.equal(closed.processExit,0);
 const listRefused=await shopA.sandbox.list_workspaces(closedReg.sandbox).then(()=>null,e=>e);assert.ok(listRefused,'list_workspaces must refuse a closed instance');assert.equal(listRefused.code,'NoSuchSandbox',String(listRefused.message));
 const sandboxes=await shopA.project.list_sandboxes();assert.deepEqual(sandboxes.items,[],'a closed instance lists no Sandbox');
 steps.push({label:'closed',list_workspaces:listRefused.code,list_sandboxes:sandboxes.items.length});
 // A retained instance refuses both read models with Unknown.
 const retainedInstance=await runtime.native.create({project:'terminal-reads',executable,host,winfsp,restrictedLauncher,work:join(out,'retained-instance')});
 const retainedReg=await runtime.native.bindClient(shopB,retainedInstance,{commitScope:'published'});
 const retainedWs=await shopB.workspace.mount(retainedReg.sandbox,'feature');
 const resident=(await retainedInstance.status()).pid;assert.equal(kill(resident),0);
 const deadline=Date.now()+15000;while(Date.now()<deadline&&!(await runtime.native.instances()).some(i=>i.id===retainedInstance.id&&i.state==='retained'))await new Promise(ok=>setTimeout(ok,50));
 assert.ok((await runtime.native.instances()).some(i=>i.id===retainedInstance.id&&i.state==='retained'),'instance must be retained');
 const rl=await shopB.sandbox.list_workspaces(retainedReg.sandbox).then(()=>null,e=>e);assert.ok(rl);assert.equal(rl.code,'Unknown',String(rl.message));
 const rs=await shopB.project.list_sandboxes().then(()=>null,e=>e);assert.ok(rs);assert.equal(rs.code,'Unknown',String(rs.message));
 steps.push({label:'retained',list_workspaces:rl.code,list_sandboxes:rs.code});
 const unmounted=await retainedInstance.workspace(retainedWs.path).unmount(true);assert.equal(unmounted.processExit,0);
 const runtimeClose=await runtime.close().then(()=>null,e=>e);assert.ok(runtimeClose,'runtime.close must refuse while an instance is retained');assert.equal(runtimeClose.code,'Unknown');
 await shopA.close();await shopB.close();shopA=undefined;shopB=undefined;
 console.log('PASS terminal read models: closed -> NoSuchSandbox/empty, retained -> Unknown for both');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{for(const c of [shopA,shopB])if(c)await c.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped terminal read models',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}