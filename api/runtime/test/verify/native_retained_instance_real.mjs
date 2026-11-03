// An unexpected resident death retains the instance: every later call is Unknown, never a restart.
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
const kill=(pid)=>{const r=spawnSync('taskkill',['/PID',String(pid),'/F'],{encoding:'utf8',timeout:10000});return {status:r.status,out:(r.stdout??'').trim().slice(0,200)};};
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'retained\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[],events=[];
try{
 let init=await runtime.project.start_init('retained-instance',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('retained-instance');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'retained-instance',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});
 const resident=(await instance.status()).pid;assert.ok(resident>0);
 const reg=await runtime.native.bindClient(shop,instance,{commitScope:'published'});
 const ws=await shop.workspace.mount(reg.sandbox,'feature');assert.equal((await instance.status()).sessions,1);
 const killed=kill(resident);assert.equal(killed.status,0,killed.out);
 // Bounded wait for the retained observation; no restart is expected at any point.
 const deadline=Date.now()+15000;let listed=null;while(Date.now()<deadline){listed=await runtime.native.instances();if(listed.some(i=>i.state==='retained'))break;await new Promise(ok=>setTimeout(ok,50));}
 assert.ok(listed.some(i=>i.state==='retained'),JSON.stringify(listed));
 const retained=listed.find(i=>i.state==='retained');
 for(const [label,call] of [['status',()=>instance.status()],['mount',()=>instance.mount('feature')],['close',()=>instance.close()]]){const e=await call().then(()=>null,e=>e);assert.ok(e,label+' must refuse');assert.equal(e.code,'Unknown',label+': '+String(e.message));}
 const runtimeClose=await runtime.close().then(()=>null,e=>e);assert.ok(runtimeClose,'runtime.close must refuse while the instance is retained');assert.equal(runtimeClose.code,'Unknown',String(runtimeClose.message));
 const again=await runtime.native.instances();assert.equal(again.find(i=>i.id===retained.id).pid,resident,'the resident is not restarted');
 steps.push({label:'retained-instance',resident,killed:killed.status,state:retained.state,sessions:retained.sessions});
 // The mount process outlived its instance; release it explicitly and record custody of the mount itself.
 const unmount=await instance.workspace(ws.path).unmount(true).then(v=>({ok:true,value:v}),e=>({ok:false,code:e.code,message:String(e.message)}));
 if(!unmount.ok){const sessionPid=(await runtime.native.list()).find(s=>s.path===ws.path)?.pid??null;if(sessionPid)events.push({label:'orphan-session-killed',pid:sessionPid,killed:kill(sessionPid)});}
 events.push({label:'retained-instance',unmount});
 save('result.json',{status:'PASS scoped retained-instance custody',read_at:new Date().toISOString(),identity,failure,steps,events,runtime_closed:runtime.closed,sessions:runtime.native.list(),instances:runtime.native.instances()});
 console.log('PASS unexpected resident death retains the instance: status/mount/close and runtime.close are Unknown, no restart');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped retained-instance custody',read_at:new Date().toISOString(),identity,failure,steps,events,runtime_closed:runtime.closed,sessions:runtime.native.list(),instances:runtime.native.instances()});}
