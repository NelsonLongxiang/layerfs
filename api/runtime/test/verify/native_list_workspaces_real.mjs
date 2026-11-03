// sandbox.list_workspaces fields on the native route: version, dirty, headMovedSinceMount.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'list workspaces\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let a,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('listing',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');a=await LayerFS.open('listing');await a.branch.fork('feature');
 const instance=await runtime.native.create({project:'listing',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});
 const ra=await runtime.native.bindClient(a,instance,{commitScope:'published'});
 const mount=await a.workspace.mount(ra.sandbox,'feature');
 const listed=await a.sandbox.list_workspaces(ra.sandbox);
 assert.equal(listed.version,null,'the native route has no daemon protocol version');
 const item=listed.items[0];assert.equal(listed.items.length,1);
 assert.equal(item.path,mount.path);assert.equal(item.branch,'feature');
 assert.ok(item.base===null||/^[0-9a-f]{64}$/.test(item.base),'base='+item.base);assert.equal(item.activity,'Idle');assert.equal(item.state,'idle');assert.equal(item.changed,false);
 assert.equal(item.headMovedSinceMount,false);assert.equal(item.pendingMerge,false);
 assert.ok(item.dirty&&'inodes' in item.dirty&&'entries' in item.dirty,'dirty counters missing');
 await a.fs.write('feature','/moved.txt','after mount\n');
 const moved=(await a.sandbox.list_workspaces(ra.sandbox)).items[0];
 assert.equal(moved.headMovedSinceMount,true,'status observes the head from the caller own Store');assert.equal(moved.activity,'Idle');
 assert.equal(moved.branch,'feature');
 const terminal=await a.workspace.unmount(mount,true);assert.equal(terminal.kind,'Unmounted');
 assert.equal((await a.sandbox.list_workspaces(ra.sandbox)).items.length,0);
 steps.push({label:'list-workspaces',version:listed.version,fields:Object.keys(item).sort(),base:item.base,headMovedBefore:item.headMovedSinceMount,headMovedAfter:moved.headMovedSinceMount});
 await instance.close();
 await a.close();a=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native list_workspaces: version null, dirty/activity fields, headMovedSinceMount flips after a Store commit');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(a)await a.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped list_workspaces',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}