// Store-face chmod and cp through the Windows-native route.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'chmod cp\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('chmod-cp',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('chmod-cp');await shop.branch.fork('feature');
 await shop.fs.write('feature','/a.txt','a\n',{mode:420});
 const before=await shop.fs.stat('feature','/a.txt');assert.equal(before.mode,420);
 await shop.fs.apply('feature',[{op:'chmod',path:'/a.txt',mode:292}],'chmod read-only');
 const after=await shop.fs.stat('feature','/a.txt');assert.equal(after.mode,292);
 await shop.fs.cp('feature','/a.txt','/c.txt','copy');
 const copied=await shop.fs.stat('feature','/c.txt');assert.equal(copied.mode,292,'cp keeps the mode');
 assert.equal((await shop.fs.read('feature','/c.txt')).text,'a\n');
 const bad=await shop.fs.apply('feature',[{op:'chmod',path:'/a.txt',mode:4096}],'bad mode').then(()=>null,e=>e);
 assert.ok(bad);assert.equal(bad.code,'InvalidInput',String(bad.message));
 assert.equal((await shop.fs.stat('feature','/a.txt')).mode,292,'the refused chmod left the mode');
 steps.push({label:'chmod-cp',beforeMode:before.mode,afterMode:after.mode,copiedMode:copied.mode,badMode:bad.code});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store chmod and cp: mode changes and copies, an out-of-range mode is refused');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped chmod cp',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
