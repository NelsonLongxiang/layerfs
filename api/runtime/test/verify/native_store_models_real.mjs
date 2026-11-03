// Store read models through the Windows-native route: revisions, file storage, commit storage.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'models\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('models',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('models');await shop.branch.fork('feature');
 await shop.fs.write('feature','/a.txt','v1\n');
 await shop.fs.edit('feature','/a.txt','v1','v2','second');
 await shop.fs.write('feature','/a.txt','v3\n');
 const head=(await shop.branch.list_commits('feature')).items[0].id;
 const backend=LayerFSBackend.of(shop);
 const revs=await backend.store.fs.list_revisions('feature','/a.txt');const revText=JSON.stringify(revs);
 assert.equal((revs.items??[]).length,3,revText.slice(0,300));
 assert.ok(revText.includes(head),'newest revision is the head');
 const file=await backend.store.fs.get_storage('feature','/a.txt');assert.ok(JSON.stringify(file).includes('size'),JSON.stringify(file).slice(0,300));
 const commits=await backend.store.branch.list_commit_storage('feature');const cText=JSON.stringify(commits);
 assert.ok((commits.items??[]).length>=3,cText.slice(0,300));
 assert.ok(cText.includes(head),'newest commit storage row is the head');
 steps.push({label:'store-models',revisions:(revs.items??[]).length,file:JSON.stringify(file).slice(0,200),commitRows:(commits.items??[]).length,head});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store read models: list_revisions, file storage and commit storage answer');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped store read models',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
