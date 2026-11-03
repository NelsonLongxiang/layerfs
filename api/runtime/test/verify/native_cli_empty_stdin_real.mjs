// CLI: empty stdin is written exactly as a zero-byte file (author preference: exact bytes).
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'cli empty\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('cli-empty',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 const store=join(init.project.volume,'global/store.sqlite');process.env.LAYERFS_STORE_PATH=store;
 shop=await LayerFS.open('cli-empty');await shop.branch.fork('feature');await shop.close();shop=undefined;
 const cli=resolve('api/cli/src/layerfs.js');
 const env={...process.env,LAYERFS_NATIVE:addon,LAYERFS_HOME:home,LAYERFS_STORE_PATH:store,LAYERFS_PROJECT:'cli-empty'};
 const run=(args,input)=>spawnSync(process.execPath,[cli,...args],{env,input,encoding:'utf8',timeout:60000});
 const empty=run(['fs','write','feature','/cli-empty.txt'],'');
 assert.equal(empty.status,0,String(empty.stderr).slice(0,400));
 const text=run(['fs','write','feature','/cli-text.txt'],'hello\n');
 assert.equal(text.status,0,String(text.stderr).slice(0,400));
 shop=await LayerFS.open('cli-empty');
 const zero=await shop.fs.read('feature','/cli-empty.txt');
 assert.equal(zero.text,'');
 const stat=await shop.fs.stat('feature','/cli-empty.txt');
 assert.equal(stat.size,0);
 const six=await shop.fs.read('feature','/cli-text.txt');
 assert.equal(six.text,'hello\n');
 steps.push({label:'cli-empty-stdin',emptyExit:empty.status,emptySize:stat.size,text:six.text});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS CLI empty stdin: a zero-byte file is written exactly, non-empty stdin unchanged');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped cli empty stdin',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}