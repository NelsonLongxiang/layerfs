// Minimal trusted-local Git history read with original native owner observation.
// <addon> <parent> <host> <WinFsp> <git.exe> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,8);
const [addon,executable,host,winfsp,git,out]=process.argv.slice(2).map(p=>resolve(p));
assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths={addon,executable,host,winfsp,git};const identity=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(readFileSync(p))]));
const source=join(out,'source'),repo=join(source,'repo'),home=join(out,'home');mkdirSync(source);mkdirSync(repo);mkdirSync(home);mkdirSync(join(source,'git-settings'));mkdirSync(join(source,'git-settings/template'));writeFileSync(join(source,'git-settings/empty-config'),'');writeFileSync(join(repo,'seed.txt'),'minimal Git history payload\n');
const gitEnv=(base)=>({GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(base,'git-settings/empty-config'),GIT_CONFIG_SYSTEM:join(base,'git-settings/empty-config'),GIT_TEMPLATE_DIR:join(base,'git-settings/template'),GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Native Reference Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Native Reference Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',GIT_AUTHOR_DATE:'2026-11-03T00:00:00+08:00',GIT_COMMITTER_DATE:'2026-11-03T00:00:00+08:00'});
const longParts=['long',...Array.from({length:5},(_,i)=>String(i)+'q'.repeat(189))];const prefix='/'+longParts.join('/')+'/';const longName='x'.repeat(1023-Buffer.byteLength(prefix))+'終';const longRelative=[...longParts,longName].join('/');mkdirSync(join(source,...longParts),{recursive:true});writeFileSync(join(source,longRelative),'long observed path');assert.equal(Buffer.byteLength('/'+longRelative),1026);
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];Object.assign(env,gitEnv(source));
for(const [index,args]of [['init','--initial-branch=main'],['add','seed.txt'],['commit','-m','seed']].entries()){
 const r=spawnSync(git,['-c','core.autocrlf=false','-c','commit.gpgsign=false','-C',repo,...args],{env,encoding:'utf8',timeout:10000});writeFileSync(join(out,'setup-'+index+'.json'),JSON.stringify({args,exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr},null,2));assert.ifError(r.error);assert.equal(r.status,0,r.stderr);
}
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,session,held,longHeld,failure=null;const events=[];
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():Buffer.isBuffer(v)?{hex:v.toString('hex')}:v,2));
async function references(){
 const rows=[];let after=0n;
 for(let n=0;n<128;n++){
  const first=await session.reference(after);if(!first.found)return rows;
  const chunks=[first.path];let row=first;
  while(row.nextOffset!==null){const next=await session.reference(after,row.nextOffset);assert.equal(next.found,true);for(const k of ['handle','serial','file','directory','lookup','cleaned','dataWritable','attributesWritable','deleteAccess','pathBytes'])assert.equal(next[k],first[k],'reference changed between path windows');chunks.push(next.path);row=next;}
  const path=Buffer.concat(chunks);assert.equal(first.pathBytes===null?null:BigInt(path.length),first.pathBytes);rows.push({...first,path:path.toString('utf8'),pathHex:path.toString('hex')});after=first.handle;
 }
 throw Error('fixture reference count exceeds observation budget');
}
const collect=async s=>{const chunks=[];for await(const b of s)chunks.push(b);return Buffer.concat(chunks);};
try{
 let job=await runtime.project.start_init('reference-project',source,{timeout:20000});const until=Date.now()+25000;while(!job.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));job=await runtime.project.get_init(job.id);}assert.equal(job.step,'done',JSON.stringify(job.error));save('init.json',job);
 process.env.LAYERFS_STORE_PATH=join(job.project.volume,'global','store.sqlite');shop=await LayerFS.open('reference-project');await shop.branch.fork('feature');
 session=await runtime.native.open({project:'reference-project',branch:'feature',executable,host,winfsp,work:join(out,'work'),path:join(out,'mount')});
 held=openSync(join(session.path,'repo/seed.txt'),'r');longHeld=openSync(join(session.path,longRelative),'r');const before=await session.state(),rows=await references(),matching=rows.filter(r=>r.path==='/repo/seed.txt');assert.ok(matching.some(r=>r.file&&!r.directory&&!r.cleaned&&!r.dataWritable));const longRow=rows.find(r=>r.path==='/'+longRelative);assert.ok(longRow);const firstWindow=await session.reference(longRow.handle-1n,0n);assert.equal(firstWindow.path.length,1024);assert.equal(firstWindow.nextOffset,1024n);assert.equal(firstWindow.path.at(-1),0xe7);const tailWindow=await session.reference(longRow.handle-1n,1024n);assert.equal(tailWindow.handle,longRow.handle);assert.equal(tailWindow.path.length,2);assert.equal(tailWindow.nextOffset,null);assert.equal(Buffer.concat([firstWindow.path,tailWindow.path]).toString('utf8'),'/'+longRelative);await assert.rejects(session.reference(longRow.handle-1n,1027n),{code:'InvalidInput'});events.push({label:'bounded-path-windows',handle:longRow.handle,bytes:1026,first:1024,tail:2,splitUTF8:true,offsetRefused:true});const after=await session.state();assert.equal(after.revision,before.revision);assert.equal(after.root,before.root);assert.equal(after.head,before.head);await assert.rejects(session.unmount(false),e=>e.code==='Busy'&&e.detail.serviceKept);events.push({label:'held-original-read',before,after,rows});closeSync(held);held=undefined;closeSync(longHeld);longHeld=undefined;
 const child=await session.exec(git,['--no-optional-locks','-c','core.autocrlf=false','-c','commit.gpgsign=false','-C',join(session.path,'repo'),'show','HEAD:seed.txt'],{env:gitEnv(session.path)});const output=Promise.all([collect(child.stdout),collect(child.stderr)]);child.stdin.end();assert.equal((await child.exited).exitCode,0);const receipt=await child.finished;const [stdout,stderr]=await output;assert.equal(stdout.toString(),'minimal Git history payload\n');assert.equal(stderr.length,0);assert.equal(receipt.restricted,false);save('git-command.json',{args:['show','HEAD:seed.txt'],receipt,stdout:stdout.toString(),stderr:stderr.toString()});
 const state=await session.state(),remaining=await references();events.push({label:'after-one-history-read',state,rows:remaining});save('references.json',events);
 if(state.handles===0n){const terminal=await session.unmount(false);assert.equal(terminal.processExit,0);events.push({label:'normal-terminal',...terminal});await shop.close();shop=undefined;await runtime.close();}
 else {assert.equal((await runtime.native.list())[0].commands,0);await assert.rejects(session.unmount(false),e=>e.code==='Busy'&&e.detail.serviceKept);events.push({label:'still-owned',unmountBusy:true,noReleaseInference:true});}
 for(const[k,p]of Object.entries(paths))assert.equal(hash(readFileSync(p)),identity[k]);console.log('OBSERVED native references after one minimal Git history read');
}catch(e){failure={message:e.message,code:e.code??null};throw e;}
finally{if(held!==undefined)closeSync(held);if(longHeld!==undefined)closeSync(longHeld);if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'OBSERVED',read_at:new Date().toISOString(),identity,failure,events,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),trusted_local:true,git_history_reads:1,oldFailureUnchanged:true});}
// Observation of a Busy owner is complete, but does not establish product release.
if(!failure&&!runtime.closed)process.exit(0);
