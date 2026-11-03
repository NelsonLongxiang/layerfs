// Direct instance.mount and SDK workspace.mount share one capacity bound.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'mixed\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[],events=[];
try{
 let init=await runtime.project.start_init('mixed-capacity',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('mixed-capacity');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'mixed-capacity',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')}),residentPID=(await instance.status()).pid;
 const reg=await runtime.native.bindClient(shop,instance,{commitScope:'published'});
 const direct=[],sdk=[];
 for(let n=0;n<8;n++)direct.push(await instance.mount('feature'));
 for(let n=0;n<8;n++)sdk.push(await shop.workspace.mount(reg.sandbox,'feature'));
 assert.equal((await instance.status()).sessions,16);
 const listed=await shop.sandbox.list_workspaces(reg.sandbox);assert.equal(listed.items.length,16,'SDK lists direct mounts too');
 const directPaths=new Set(direct.map(d=>resolve(d.path)));assert.equal(listed.items.filter(i=>directPaths.has(resolve(i.path))).length,8);
 await assert.rejects(shop.workspace.mount(reg.sandbox,'feature'),{code:'Capacity'});
 await assert.rejects(instance.mount('feature'),{code:'Capacity'});
 assert.equal((await instance.status()).sessions,16);
 writeFileSync(join(direct[0].path,'direct.txt'),'direct payload\n');writeFileSync(join(sdk[0].path,'sdk.txt'),'sdk payload\n');
 const directCommit=await direct[0].commit('published',true,'direct commit',false);assert.equal(directCommit.changed,true);
 const sdkCommit=await shop.workspace.commit(sdk[0],'sdk commit');assert.equal(sdkCommit.kind,'Committed');
 const history=await shop.branch.list_commits('feature');assert.equal(history.items.length,2);
 assert.equal((await shop.fs.read('feature','/direct.txt')).text,'direct payload\n');assert.equal((await shop.fs.read('feature','/sdk.txt')).text,'sdk payload\n');
 steps.push({label:'mixed-capacity',direct:8,sdk:8,sessions:16,listed:16,refusals:2,history:history.items.length});
 const terminals=[];
 for(const d of direct){const t=await d.unmount(true);assert.equal(t.nativeExit,0);assert.equal(t.processExit,0);assert.equal(t.overlayClosed,true);terminals.push(t.nativeExit);}
 for(const s of sdk){const t=await shop.workspace.unmount(s,true);assert.equal(t.nativeExit,0);assert.equal(t.processExit,0);assert.equal(t.overlayClosed,true);terminals.push(t.nativeExit);}
 assert.equal((await instance.status()).sessions,0);
 const closed=await shop.sandbox.close(reg.sandbox);assert.equal(closed.tokenClosed,true);assert.equal(closed.desktopClosed,true);assert.equal(closed.processExit,0);assert.equal(residentPID>0,true);await assert.rejects(instance.status(),{code:'NoSuchSandbox'});
 events.push({label:'terminals',workspaces:16,closed});await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS mixed direct+SDK mounts share 16 admissions: both entrypoints refuse Capacity, SDK lists direct mounts, clean terminals');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped mixed capacity',read_at:new Date().toISOString(),identity,failure,steps,events,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),instances:runtime.closed?[]:await runtime.native.instances()});}
