// A missing Branch must refuse before an original target is started.
// <addon> <parent> <host> <WinFsp> <resident> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,8);
const [addon,executable,host,winfsp,restrictedLauncher,out]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const save=(n,v)=>writeFileSync(join(out,n),JSON.stringify(v,null,2));
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'s.txt'),'missing branch\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('missing-branch',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('missing-branch');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'missing-branch',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});const reg=await runtime.native.bindClient(shop,instance,{commitScope:'published'});
 const before=await instance.status();assert.equal(before.sessions,0);
 const rejected=await shop.workspace.mount(reg.sandbox,'missing-branch').then(()=>null,e=>e);
 assert.ok(rejected,'a missing Branch must not mount');assert.equal(rejected.code,'NoSuchBranch',String(rejected.message));
 const after=await instance.status();assert.equal(after.sessions,0,'a refused mount must not consume an owner');
 const protectedMain=await shop.workspace.mount(reg.sandbox,'main').then(()=>null,e=>e);assert.ok(protectedMain);assert.equal(protectedMain.code,'NoSuchBranch',String(protectedMain.message));
 for(const bad of ['', '   ', 42, null]){const refused=await shop.workspace.mount(reg.sandbox,bad).then(()=>null,e=>e);assert.ok(refused,'mount must refuse '+String(bad));assert.equal(refused.code,'InvalidInput',String(refused.message));}
 assert.equal((await instance.status()).sessions,0,'no refusal may consume an owner');
 const ws=await shop.workspace.mount(reg.sandbox,'feature');assert.equal((await instance.status()).sessions,1);
 const end=await shop.workspace.unmount(ws);assert.equal(end.processExit,0);
 const closed=await instance.close();assert.equal(closed.processExit,0);
 steps.push({label:'missing-branch',code:rejected.code,sessionsAfter:after.sessions,validMount:true});
 await shop.close();shop=undefined;await runtime.close();
 console.log('PASS missing Branch refuses before target creation: NoSuchBranch, no owner consumed, instance stays usable');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped missing-Branch refusal',read_at:new Date().toISOString(),failure,steps,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),instances:runtime.closed?[]:await runtime.native.instances()});}
