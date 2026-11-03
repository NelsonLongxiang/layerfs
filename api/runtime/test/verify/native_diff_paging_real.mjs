// Store-face diff paging and hunks:false through the Windows-native route.
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
 await shop.fs.apply('feature',[{op:'write',path:'/a.txt',content:'a\n'},{op:'write',path:'/b.txt',content:'b\n'},{op:'write',path:'/c.txt',content:'c\n'}],'three files');
 const base=(await shop.branch.list_commits('feature')).items[0].id;
 await shop.fs.apply('feature',[{op:'write',path:'/d.txt',content:'d\n'},{op:'write',path:'/e.txt',content:'e\n'},{op:'write',path:'/f.txt',content:'f\n'}],'three more files');
 const head=(await shop.branch.list_commits('feature')).items[0].id;assert.notEqual(head,base);
 const p1=await shop.branch.diff_commits(base,head,1);assert.equal(p1.items.length,1);assert.equal(p1.hasMore,true);assert.equal(p1.nextPagePos,1);
 const p2=await shop.branch.diff_commits(base,head,1,1);assert.equal(p2.items.length,1);assert.notEqual(p2.items[0].path,p1.items[0].path);
 const all=await shop.branch.diff_commits(base,head,50);assert.equal(all.items.length,3);assert.equal(all.hasMore,false);
 const bare=await shop.branch.diff_commits(base,head,50,0,{hunks:false});assert.equal(bare.items.length,3);assert.ok(bare.items.every(i=>i.hunks===null),JSON.stringify(bare.items[0]));
 await shop.branch.fork('other');
 await shop.fs.apply('other',[{op:'write',path:'/g.txt',content:'g\n'},{op:'write',path:'/h.txt',content:'h\n'}],'other files');
 const br=await shop.branch.diff_branches('other','feature',1);assert.equal(br.items.length,1);assert.equal(br.hasMore,true);
 steps.push({label:'paging',pages:[p1.items[0].path,p2.items[0].path],all:all.items.map(i=>i.path).sort(),bareHunks:bare.items.map(i=>i.hunks??null),branchFirst:br.items[0].path,nextPagePos:p1.nextPagePos});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store diff paging: pageSize/nextPagePos walk all paths and hunks:false drops hunks');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped diff paging',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}