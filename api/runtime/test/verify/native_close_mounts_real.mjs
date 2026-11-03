// Instance close waits for its mounts; closing twice is the same terminal, and the SDK refuses a closed one.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'close\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('close-mounts',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('close-mounts');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'close-mounts',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});
 const reg=await runtime.native.bindClient(shop,instance,{commitScope:'published'});
 const ws1=await shop.workspace.mount(reg.sandbox,'feature'),ws2=await shop.workspace.mount(reg.sandbox,'feature');
 const refused=await instance.close().then(()=>null,e=>e);assert.ok(refused,'close must refuse while mounts remain');assert.equal(refused.code,'MountsActive',String(refused.message));
 const sdkRefused=await shop.sandbox.close(reg.sandbox).then(()=>null,e=>e);assert.ok(sdkRefused);assert.equal(sdkRefused.code,'MountsActive',String(sdkRefused.message));
 steps.push({label:'refused-with-mounts',direct:refused.code,sdk:sdkRefused.code,sessions:(await instance.status()).sessions});
 await shop.workspace.unmount(ws1,true);await shop.workspace.unmount(ws2,true);
 assert.equal((await instance.status()).sessions,0);
 const closed=await instance.close();assert.equal(closed.processExit,0);assert.equal(closed.tokenClosed,true);assert.equal(closed.desktopClosed,true);
 const again=await instance.close();assert.deepEqual(again,closed,'the second close returns the same terminal');
 const sdkAfter=await shop.sandbox.close(reg.sandbox).then(()=>null,e=>e);assert.ok(sdkAfter,'the SDK must not close a closed instance');assert.equal(sdkAfter.code,'NoSuchSandbox',String(sdkAfter.message));
 const listed=await runtime.native.instances();assert.equal(listed.find(i=>i.id===closed.id)?.state??'closed','closed');
 steps.push({label:'closed',closed,sameTerminal:true,sdkAfter:sdkAfter.code});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS instance close: MountsActive while mounted, same terminal when closed twice, SDK refuses the closed one');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped instance close',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
