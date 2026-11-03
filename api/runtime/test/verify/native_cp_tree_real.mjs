// Store-face recursive fs.cp and overwrite-by-write (Windows-native route).
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'cp\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('cp-tree',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('cp-tree');await shop.branch.fork('feature');
 await shop.fs.mkdir('feature','/src/sub','tree');
 await shop.fs.write('feature','/src/a.txt','one\n');
 await shop.fs.write('feature','/src/b.txt','two\n');
 await shop.fs.write('feature','/src/sub/c.txt','three\n');
 await shop.fs.cp('feature','/src','/dst','copy tree');
 const dst=await shop.fs.list('feature','/dst',50,0);
 assert.deepEqual(dst.items.map(i=>i.name??i.path).sort(),['a.txt','b.txt','sub']);
 assert.equal((await shop.fs.read('feature','/dst/sub/c.txt')).text,'three\n');
 await shop.fs.write('feature','/dst/a.txt','ONE\n');
 assert.equal((await shop.fs.read('feature','/dst/a.txt')).text,'ONE\n');
 assert.equal((await shop.fs.stat('feature','/dst/a.txt')).size,4);
 steps.push({label:'cp-tree',dst:dst.items.map(i=>i.name??i.path),nested:'three\\n',overwritten:'ONE\\n'});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store cp tree: directory copied recursively, nested file read, write overwrites');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped cp tree',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
