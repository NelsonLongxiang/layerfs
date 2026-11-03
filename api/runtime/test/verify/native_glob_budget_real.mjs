// Store-face fs.glob reply-budget truncation (Windows-native route).
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'budget\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('budget',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('budget');await shop.branch.fork('feature');
 const changes=[];for(let n=0;n<250;n++)changes.push({op:'write',path:'/f'+'x'.repeat(200)+String(n).padStart(3,'0')+'.txt',content:'x\n'});
 await shop.fs.apply('feature',changes,'250 long names');
 const pages=[];let pos=0,hasMore=true,guard=0;
 while(hasMore&&guard<10){
   const page=await shop.fs.glob('feature','/f*.txt','/',1000,pos);
   pages.push({items:page.items.length,hasMore:page.hasMore,nextPagePos:page.nextPagePos});
   assert.ok(page.items.length<=1000);
   if(page.hasMore)assert.ok(page.nextPagePos>pos,'a truncated page must name the next position');
   pos=page.nextPagePos??pos;hasMore=page.hasMore;guard++;
 }
 const seen=new Set();for(const p of pages)seen.add(p.items);
 const total=pages.reduce((a,p)=>a+p.items,0);
 assert.ok(pages.length>1,'the budget must truncate a 250-path listing');
 assert.equal(total,250,'pages together list every file');
 steps.push({label:'glob-budget',pages,total,nextPositions:pages.map(p=>p.nextPagePos)});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store glob budget: a 250-path listing truncates and pages cover all files');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped glob budget',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
