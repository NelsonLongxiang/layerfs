// Store-face branch.list_commits paging (Windows-native route).
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'commits\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('commits',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('commits');await shop.branch.fork('feature');
 for(let n=1;n<=5;n++)await shop.fs.write('feature','/f'+n+'.txt','n'+n+'\n','commit '+n);
 const p1=await shop.branch.list_commits('feature',2,0);
 assert.equal(p1.items.length,2);assert.equal(p1.hasMore,true);assert.equal(p1.nextPagePos,2);
 const p2=await shop.branch.list_commits('feature',2,2);
 assert.equal(p2.items.length,2);assert.equal(p2.nextPagePos,4);
 const p3=await shop.branch.list_commits('feature',2,4);
 assert.equal(p3.items.length,1);assert.equal(p3.hasMore,false);
 const messages=[...p1.items,...p2.items,...p3.items].map(c=>c.message).sort();
 assert.deepEqual(messages,['commit 1','commit 2','commit 3','commit 4','commit 5']);
 steps.push({label:'list-commits-paging',pages:[p1.items.length,p2.items.length,p3.items.length],next:[p1.nextPagePos,p2.nextPagePos,p3.nextPagePos??null],messages});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store list_commits paging: 2+2+1 commits cover five messages');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped list_commits paging',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
