// Store-face glob and grep paging through the Windows-native route.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'paging\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('paging',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('paging');await shop.branch.fork('feature');
 const files=[];for(let n=1;n<=5;n++)files.push({op:'write',path:'/f'+n+'.txt',content:'needle '+n+'\n'});
 await shop.fs.apply('feature',files,'five files');
 const g1=await shop.fs.glob('feature','/f*.txt','/',2,0);
 assert.equal(g1.items.length,2);assert.equal(g1.hasMore,true);assert.equal(g1.nextPagePos,2);
 const g2=await shop.fs.glob('feature','/f*.txt','/',2,2);
 assert.equal(g2.items.length,2);assert.equal(g2.hasMore,true);
 const g3=await shop.fs.glob('feature','/f*.txt','/',2,4);
 assert.equal(g3.items.length,1);assert.equal(g3.hasMore,false);
 const all=new Set([...g1.items,...g2.items,...g3.items]);
 assert.equal(all.size,5,'three pages cover five files');
 const r1=await shop.fs.grep('feature','needle','/',2,0);
 assert.equal(r1.items.length,2);assert.equal(r1.hasMore,true);assert.ok(r1.items[0].path,'grep items carry a path');
 const r2=await shop.fs.grep('feature','needle','/',2,2);
 assert.equal(r2.items.length,2);
 const r3=await shop.fs.grep('feature','needle','/',2,4);
 assert.equal(r3.items.length,1);assert.equal(r3.hasMore,false);
 steps.push({label:'paging',globPages:[g1.items.length,g2.items.length,g3.items.length],globHasMore:[g1.hasMore,g2.hasMore,g3.hasMore],grepPages:[r1.items.length,r2.items.length,r3.items.length],nextPagePos:g1.nextPagePos});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store glob and grep paging: pageSize/pagePos cover every file and match');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped glob grep paging',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}