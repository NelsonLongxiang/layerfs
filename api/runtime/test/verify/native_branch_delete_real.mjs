// Store-face branch.delete through the Windows-native route (#352 F-058).
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'delete\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
const names=async()=>(await shop.project.list_branches()).items.map(b=>b.name).sort();
try{
 let init=await runtime.project.start_init('delete',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('delete');
 // 1. an empty Branch deletes without force.
 await shop.branch.fork('empty');
 const empty=await shop.branch.delete('empty');
 assert.equal(empty.kind,'Deleted');assert.equal(empty.branch,'empty');assert.equal(empty.unmerged,0);assert.equal(empty.head,null);
 assert.ok(!(await names()).includes('empty'),'the deleted Branch is no longer listed');
 // 2. a Branch a published Layer names is refused: the schema keeps that reference.
 await shop.branch.fork('merged');await shop.fs.write('merged','/merged.txt','merged\n');await shop.branch.publish('merged');
 const published=await shop.branch.delete('merged').then(()=>null,e=>e);
 assert.ok(published,'a published Branch must not be deleted');assert.equal(published.code,'Published',String(published.message));
 assert.ok((await names()).includes('merged'));
 // 3. an unmerged Branch is refused and stays.
 await shop.branch.fork('unmerged');await shop.fs.write('unmerged','/work.txt','work\n');
 const refused=await shop.branch.delete('unmerged').then(()=>null,e=>e);
 assert.ok(refused,'an unmerged Branch must not be deleted');assert.equal(refused.code,'Unmerged',String(refused.message));
 assert.equal(refused.detail.unmerged,1);assert.ok((await names()).includes('unmerged'));
 // 4. force deletes it.
 const forced=await shop.branch.delete('unmerged',true);
 assert.equal(forced.kind,'Deleted');assert.equal(forced.unmerged,1);
 assert.ok(!(await names()).includes('unmerged'));
 // 5. main is refused.
 const main=await shop.branch.delete('main').then(()=>null,e=>e);assert.ok(main);assert.equal(main.code,'InvalidInput',String(main.message));
 // 6. a missing Branch is refused.
 const missing=await shop.branch.delete('nope').then(()=>null,e=>e);assert.ok(missing);assert.equal(missing.code,'NoSuchBranch',String(missing.message));
 // 7. the name is reusable and a fork from it works.
 await shop.branch.fork('unmerged');await shop.fs.write('unmerged','/again.txt','again\n');
 assert.ok((await names()).includes('unmerged'));
 steps.push({label:'delete',empty:empty.kind,published:published.code,refused:refused.code,forcedUnmerged:forced.unmerged,main:main.code,missing:missing.code,reused:true});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store branch.delete: an empty Branch deletes, a published one is refused, unmerged need force, main and missing refuse, the name is reusable');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped branch delete',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}