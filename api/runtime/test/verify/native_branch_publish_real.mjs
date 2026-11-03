// Store-face branch.publish through the Windows-native route.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'publish\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('publish',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('publish');await shop.branch.fork('feature');
 await shop.branch.fork('side');
 await shop.fs.write('feature','/pub.txt','first\n');
 await shop.fs.write('side','/pub.txt','side\n');
 const published=await shop.branch.publish('feature');assert.equal(published.kind,'Added');assert.ok(published.publishedLayer,'a new Layer is named');
 assert.equal((await shop.fs.read('main','/pub.txt')).text,'first\n');
 const again=await shop.branch.publish('feature');assert.equal(again.kind,'UpToDate');
 const second=await shop.branch.publish('side');assert.equal(second.kind,'Added');assert.ok(Array.isArray(second.overwrote));assert.ok(second.overwrote.length>=1,'a diverged publish lists the skipped main Layer');
 assert.equal((await shop.fs.read('main','/pub.txt')).text,'side\n');
 const missing=await shop.branch.publish('nope').then(()=>null,e=>e);assert.ok(missing);assert.equal(missing.code,'NoSuchBranch',String(missing.message));
 steps.push({label:'publish',first:published.kind,layer:published.publishedLayer,again:again.kind,second:second.kind,overwrote:second.overwrote.length,missing:missing.code});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store branch.publish: main shows the head, repeat is UpToDate, a new Layer lists overwritten');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped branch publish',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}