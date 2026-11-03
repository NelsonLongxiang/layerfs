// Store-face fs operations through the Windows-native route: mkdir/write/cp/mv/glob/grep/list/stat/rm.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'store ops\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('store-ops',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('store-ops');await shop.branch.fork('feature');
 await shop.fs.mkdir('feature','/docs','docs');
 await shop.fs.write('feature','/docs/a.txt','alpha\n');
 await shop.fs.cp('feature','/docs/a.txt','/docs/b.txt','copy');
 await shop.fs.mv('feature','/docs/b.txt','/docs/c.txt','move');
 const listed=(await shop.fs.list('feature','/docs')).items.map(i=>i.name).sort();assert.deepEqual(listed,['a.txt','c.txt']);
 const glob=(await shop.fs.glob('feature','**/*.txt')).items.map(i=>typeof i==='string'?i:i.path).sort();assert.deepEqual(glob,['/docs/a.txt','/docs/c.txt','/seed.txt']);
 const grep=await shop.fs.grep('feature','alpha');assert.ok(JSON.stringify(grep.items).includes('/docs/a.txt'),JSON.stringify(grep.items));
 const stat=await shop.fs.stat('feature','/docs/c.txt');assert.equal(stat.type,'file');assert.equal(stat.size,6);
 assert.equal((await shop.fs.read('feature','/docs/c.txt')).text,'alpha\n');
 await shop.fs.rm('feature','/docs/c.txt','remove');
 assert.deepEqual((await shop.fs.list('feature','/docs')).items.map(i=>i.name),['a.txt']);
 await shop.fs.rm('feature','/docs','remove dir');
 assert.deepEqual((await shop.fs.list('feature','/')).items.map(i=>i.name),['seed.txt']);
 steps.push({label:'store-fs',listed,glob,stat,remaining:['seed.txt']});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store fs: mkdir/write/cp/mv/glob/grep/list/stat/rm all behave');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped native store fs ops',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
