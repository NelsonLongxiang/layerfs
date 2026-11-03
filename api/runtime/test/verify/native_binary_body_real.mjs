// Store-face binary body write/read/diff through the Windows-native route.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'binary\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('binary',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('binary');await shop.branch.fork('feature');
 const first=Uint8Array.from([0,1,2,255,254]);await shop.fs.write('feature','/bin.dat',first,'binary v1');
 const refused=await shop.fs.read('feature','/bin.dat').then(()=>null,e=>e);assert.ok(refused,'text read must refuse binary content');assert.equal(refused.code,'Binary',String(refused.message));assert.match(String(refused.message),/UTF-8/);
 const c1=(await shop.branch.list_commits('feature')).items[0].id;
 const second=Uint8Array.from([9,8,7,6,5]);await shop.fs.write('feature','/bin.dat',second,'binary v2');
 const c2=(await shop.branch.list_commits('feature')).items[0].id;
 const diff=await shop.fs.diff_files(c1,'/bin.dat',c2,'/bin.dat');const dtext=JSON.stringify(diff);
 assert.ok(dtext.includes('Binary')||dtext.includes('binary')||diff.kind!==undefined,dtext.slice(0,400));
 steps.push({label:'binary',readRefusal:refused.code,first:[...first],diffKind:diff.kind??null,diffSample:dtext.slice(0,260)});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store binary body: bytes land, text read refuses Binary, binary diff reported');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped binary body',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
