// The two native entrypoints are interchangeable over the same original Sessions.
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
const save=(n,v)=>writeFileSync(join(out,n),JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2));
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'interchange\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('interchange',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('interchange');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'interchange',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});
 const reg=await runtime.native.bindClient(shop,instance,{commitScope:'published'});
 const direct=await instance.mount('feature'),sdk=await shop.workspace.mount(reg.sandbox,'feature');
 assert.equal((await instance.status()).sessions,2);
 const directRef={sandbox:reg.sandbox,path:direct.path},sdkRef={sandbox:reg.sandbox,path:sdk.path};
 // SDK reads and commits a mount created directly.
 const seen=await LayerFSBackend.of(shop).daemon.workspace.status(directRef);assert.equal(seen.workspace,(await direct.state()).workspace);assert.equal(seen.activity,'Idle');
 writeFileSync(join(direct.path,'direct.txt'),'direct side\n');
 const viaSdk=await shop.workspace.commit(directRef,'sdk commits a direct mount');assert.equal(viaSdk.kind,'Committed');
 // The direct handle commits a mount created through the SDK.
 writeFileSync(join(sdk.path,'sdk.txt'),'sdk side\n');
 const sdkHandle=instance.workspace(sdk.path);assert.equal(typeof sdkHandle.commit,'function');
 const viaDirect=await sdkHandle.commit('published',true,'direct commits an sdk mount',false);assert.equal(viaDirect.changed,true);
 const history=await shop.branch.list_commits('feature');assert.equal(history.items.length,2);
 assert.equal((await shop.fs.read('feature','/direct.txt')).text,'direct side\n');assert.equal((await shop.fs.read('feature','/sdk.txt')).text,'sdk side\n');
 steps.push({label:'cross-entrypoint',viaSdk:viaSdk.head,viaDirect:viaDirect.head??null,history:history.items.length});
 // Cross unmount: each entrypoint releases the other's mount.
 const goneSdk=await shop.workspace.unmount(directRef,true);assert.equal(goneSdk.processExit,0);assert.equal(goneSdk.overlayClosed,true);
 const goneDirect=await instance.workspace(sdk.path).unmount(true);assert.equal(goneDirect.processExit,0);assert.equal(goneDirect.overlayClosed,true);
 assert.equal((await instance.status()).sessions,0);
 const closed=await instance.close();assert.equal(closed.processExit,0);
 steps.push({label:'cross-unmount',sessions:0});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS entrypoints are interchangeable: SDK and direct handles commit, read and unmount each other mounts');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped entrypoint interchange',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),instances:runtime.closed?[]:await runtime.native.instances()});}
