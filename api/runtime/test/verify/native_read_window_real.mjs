// Store-face fs.read line window through the Windows-native route.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'window\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('window',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('window');await shop.branch.fork('feature');
 await shop.fs.write('feature','/lines.txt','l1\nl2\nl3\nl4\nl5\n');
 const window=await shop.fs.read('feature','/lines.txt',2,4);
 assert.equal(window.startLine,2);assert.equal(window.endLine,4);
 assert.ok(window.text.includes('l2')&&window.text.includes('l4'),JSON.stringify(window.text));
 assert.ok(!window.text.includes('l1')&&!window.text.includes('l5'),JSON.stringify(window.text));
 const tail=await shop.fs.read('feature','/lines.txt',3);
 assert.equal(tail.startLine,3);assert.equal(tail.endLine,5);assert.ok(tail.text.includes('l3')&&tail.text.includes('l5'));
 const beyond=await shop.fs.read('feature','/lines.txt',9);
 assert.equal(beyond.text,'');assert.equal(beyond.endLine,null);
 const backwards=await shop.fs.read('feature','/lines.txt',4,2).then(()=>null,e=>e);
 assert.ok(backwards);assert.equal(backwards.code,'InvalidInput',String(backwards.message));
 steps.push({label:'window',windowText:JSON.stringify(window.text),windowEnd:window.endLine,tailEnd:tail.endLine,beyond:beyond.endLine,backwards:backwards.code});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store read window: startLine/endLine, tail, beyond EOF, reversed refused');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped read window',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
