// Store-face fs.edit match refusals: AmbiguousMatch and NoMatch.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'edit match\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('edit-match',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('edit-match');await shop.branch.fork('feature');
 await shop.fs.write('feature','/dup.txt','x\nx\n');
 const ambiguous=await shop.fs.edit('feature','/dup.txt','x','y').then(()=>null,e=>e);
 assert.ok(ambiguous,'two occurrences must not be edited');assert.equal(ambiguous.code,'AmbiguousMatch',String(ambiguous.message));
 assert.equal((await shop.fs.read('feature','/dup.txt')).text,'x\nx\n');
 const noMatch=await shop.fs.edit('feature','/dup.txt','zzz','y').then(()=>null,e=>e);
 assert.ok(noMatch);assert.equal(noMatch.code,'NoMatch',String(noMatch.message));
 await shop.fs.write('feature','/one.txt','unique\n');
 await shop.fs.edit('feature','/one.txt','unique','changed','single');
 assert.equal((await shop.fs.read('feature','/one.txt')).text,'changed\n');
 steps.push({label:'edit-match',ambiguous:ambiguous.code,ambiguousDetail:JSON.stringify(ambiguous.detail??null).slice(0,120),noMatch:noMatch.code,single:'changed'});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store edit matches: AmbiguousMatch and NoMatch refuse, a single match edits');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped edit matches',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
