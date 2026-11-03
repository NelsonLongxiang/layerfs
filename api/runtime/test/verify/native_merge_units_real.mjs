// Store-face branch.merge units through the Windows-native route (#352 F-057).
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'units\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('units',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('units');await shop.branch.fork('ours');await shop.branch.fork('theirs');
 await shop.fs.mkdir('ours','/gen');await shop.fs.mkdir('theirs','/gen');
 await shop.fs.write('ours','/gen/a.txt','ours\n');
 await new Promise(ok=>setTimeout(ok,1100));
 await shop.fs.write('theirs','/gen/b.txt','theirs\n');
 await shop.fs.write('theirs','/plain.txt','only theirs\n');
 const merged=await shop.branch.merge('ours','theirs','merged','merge with units',[{name:'gen',patterns:['/gen/']}]);
 const unit=merged.units[0];
 assert.equal(merged.units.length,1,'only the unit both sides changed is reported');
 assert.equal(unit.unit,'gen');assert.equal(unit.kept,'theirs','the later write wins');
 assert.equal(unit.changedOurs,2,'the /gen directory and its file');assert.equal(unit.changedTheirs,2);assert.equal(unit.dropped,2);
 assert.equal((await shop.fs.read('merged','/gen/b.txt')).text,'theirs\n');
 const gone=await shop.fs.read('merged','/gen/a.txt').then(()=>null,e=>e);assert.ok(gone);assert.equal(gone.code,'NoSuchPath');
 assert.equal((await shop.fs.read('merged','/plain.txt')).text,'only theirs\n');
 steps.push({label:'units',units:merged.units.length,kept:unit.kept,dropped:unit.dropped,changedOurs:unit.changedOurs,changedTheirs:unit.changedTheirs,merged:merged.kind});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store merge units: a unit both sides changed is taken whole from the later side');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped merge units',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}