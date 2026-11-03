// Store-face fs.edit across its 32 KiB scan windows (Windows-native route).
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'edit window\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('edit-window',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('edit-window');await shop.branch.fork('feature');
 // A unique marker starting at 32,760 straddles the 32 KiB scan boundary at 32,768.
 const body='a'.repeat(32760)+'NEEDLE'+'a'.repeat(1000);
 await shop.fs.write('feature','/straddle.txt',body);
 assert.equal((await shop.fs.read('feature','/straddle.txt')).text.length,body.length);
 await shop.fs.edit('feature','/straddle.txt','NEEDLE','X','cross window');
 const after=(await shop.fs.read('feature','/straddle.txt')).text;
 assert.equal(after.length,body.length-5);
 assert.ok(after.includes('X')&&!after.includes('NEEDLE'));
 assert.equal(after.slice(32760,32761),'X');
 // A marker wholly past the first window also edits.
 const far='b'.repeat(40000)+'FAR';
 await shop.fs.write('feature','/far.txt',far);
 await shop.fs.edit('feature','/far.txt','FAR','Y','past window');
 const farAfter=(await shop.fs.read('feature','/far.txt')).text;
 assert.equal(farAfter.length,40001);assert.equal(farAfter.slice(-1),'Y');
 steps.push({label:'edit-window',straddle:{before:body.length,after:after.length,at:after.slice(32760,32761)},far:{before:far.length,after:farAfter.length,tail:farAfter.slice(-1)}});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store edit window: a match straddling 32 KiB and one past it both edit');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped edit window',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
