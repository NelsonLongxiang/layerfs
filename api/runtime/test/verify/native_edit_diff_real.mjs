// Store-face edit/blame/diff through the Windows-native route.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'edit diff\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
try{
 let init=await runtime.project.start_init('edit-diff',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('edit-diff');await shop.branch.fork('feature');
 await shop.fs.write('feature','/note.txt','one\ntwo\nthree\n');
 const edited=await shop.fs.edit('feature','/note.txt','two','TWO','edit two');
 assert.equal((await shop.fs.read('feature','/note.txt')).text,'one\nTWO\nthree\n');
 const blame=await shop.fs.blame('feature','/note.txt');const blameText=JSON.stringify(blame);assert.ok(blameText.includes('TWO'),blameText.slice(0,300));
 await shop.fs.write('feature','/other.txt','other\n');
 const commits=(await shop.branch.list_commits('feature')).items;assert.ok(commits.length>=2);
 const [newer,older]=[commits[0].id,commits[commits.length-1].id];
 const diff=await shop.branch.diff_commits(older,newer);const diffText=JSON.stringify(diff);assert.ok(diffText.includes('/other.txt')||diffText.includes('other.txt'),diffText.slice(0,400));
 const branches=await shop.branch.diff_branches('main','feature');const bText=JSON.stringify(branches);assert.ok(bText.includes('/note.txt')&&bText.includes('/other.txt'),bText.slice(0,400));
 steps.push({label:'edit-diff',editHead:edited.head??null,blameLines:(blame.items??blame.lines??[]).length,commits:commits.length,diff:diffText.slice(0,200),branches:bText.slice(0,200)});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native Store edit/blame/diff: edit rewrites text, blame names the change, diffs list the paths');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped edit/blame/diff',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
