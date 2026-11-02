// Actual SDK/native Windows Git preserves the complete mutable Workspace, not a
// Git-filtered export. No source checkout, global Git config or old receipt is changed.
// <addon> <parent> <host> <WinFsp> <resident> <git.exe> <fresh-output>
// Default restricted-sdk mode is never retried as trusted-local. Set
// LAYERFS_TEST_GIT_MODE=trusted-local only for a separate, explicitly scoped run.
// Failure receipts remain FAIL even when intermediate data checkpoints pass.
// LAYERFS_TEST_GIT_CWD_PROBE optionally observes public cwd APIs before Git.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,lstatSync,renameSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
import {LayerFSBackend} from '@layerfs/backend';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,9);
const [addon,executable,host,winfsp,restrictedLauncher,git,out]=process.argv.slice(2).map(p=>resolve(p));
assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths={addon,executable,host,winfsp,restrictedLauncher,git};
const identity=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,sha(readFileSync(p))]));
const trusted=process.env.LAYERFS_TEST_GIT_MODE==='trusted-local';if(process.env.LAYERFS_TEST_GIT_MODE&&!trusted)assert.equal(process.env.LAYERFS_TEST_GIT_MODE,'restricted-sdk');
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'SDK Git lifecycle seed\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});
assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);writeFileSync(join(out,'home-acl.json'),JSON.stringify({exit:acl.status,stdout:acl.stdout,stderr:acl.stderr},null,2));
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;process.env.LAYERFS_TRACE=join(out,'sdk-trace.jsonl');
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null,phase='init',sequence=0;
const commands=[],events=[],closeObservations=[],sessions=new Map();let localIndex=0;
const createWorkspace=async(instance,registration)=>{if(!trusted)return shop.workspace.mount(registration.sandbox,'feature');const n=++localIndex;const session=await runtime.native.open({project:'git-project',branch:'feature',executable,host,winfsp,work:join(out,n+'-work'),path:join(out,n+'-mount')});sessions.set(session.path,session);return {path:session.path};};
const execute=(ws,exe,args,env)=>trusted?sessions.get(ws.path).exec(exe,args,{env}):shop.workspace.exec(ws,{mode:'windows-native',executable:exe,args,env});
const status=(backend,ws)=>trusted?sessions.get(ws.path).state():backend.daemon.workspace.status(ws).then(s=>s.native);
const publish=async(ws)=>{if(!trusted)return shop.workspace.commit(ws);const r=await sessions.get(ws.path).commit('published',true);return {...r,kind:r.changed?'Committed':'UpToDate'};};
const checkpoints={gitCreated:false,indexWorkingStateSaved:false,firstPublished:false,firstNormalClose:false,firstRemountExact:false,secondPublished:false,secondNormalClose:false,secondRemountExact:false,thirdNormalClose:false,instanceClosed:false};
const collect=async stream=>{const chunks=[];for await(const b of stream)chunks.push(b);return Buffer.concat(chunks);};
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2));
function manifest(root,dir=root){
  const rows=[];
  for(const name of readdirSync(dir).sort()){
    const p=join(dir,name),s=lstatSync(p),path=relative(root,p).replaceAll('\\','/');
    if(s.isDirectory()){rows.push({path,kind:'directory'});rows.push(...manifest(root,p));}
    else {assert.ok(s.isFile(),'fixture contains only regular files/directories');const bytes=readFileSync(p);rows.push({path,kind:'file',bytes:bytes.length,sha256:sha(bytes)});}
  }
  return rows;
}
function gitEnv(ws){
  const folder=join(ws.path,'git-settings'),empty=join(folder,'empty-config');
  if(!existsSync(folder)){mkdirSync(folder);mkdirSync(join(folder,'template'));writeFileSync(empty,'');}
  return {HOME:folder,USERPROFILE:folder,XDG_CONFIG_HOME:folder,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:empty,GIT_CONFIG_GLOBAL:empty,GIT_TEMPLATE_DIR:join(folder,'template'),GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Native SDK Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Native SDK Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',GIT_AUTHOR_DATE:'2026-11-03T00:00:00+08:00',GIT_COMMITTER_DATE:'2026-11-03T00:00:00+08:00'};
}
async function gitRun(ws,args,{readOnly=false}={}){
  const id=String(++sequence).padStart(2,'0'),started=new Date().toISOString();
  const input=[...(readOnly?['--no-optional-locks']:[]),'-c','core.autocrlf=false','-c','commit.gpgsign=false','-C',join(ws.path,'repo'),...args];
  const receipt={id,phase,args:input,started,root:null,finished:null,error:null};save('progress.json',{phase,command:id,args:input});
  try{
    const child=await execute(ws,git,input,gitEnv(ws));
    const output=Promise.all([collect(child.stdout),collect(child.stderr)]);child.stdin.end();receipt.root=await child.exited;receipt.finished=await child.finished;
    const [stdout,stderr]=await output;writeFileSync(join(out,id+'-stdout.bin'),stdout);writeFileSync(join(out,id+'-stderr.bin'),stderr);
    Object.assign(receipt,{command:child.id,pid:child.pid,restricted:child.restricted,stdoutBytes:stdout.length,stdoutSha256:sha(stdout),stderrBytes:stderr.length,stderr:stderr.toString('utf8')});
    save(id+'.json',receipt);commands.push(receipt);assert.equal(child.restricted,!trusted);assert.deepEqual(receipt.root,{exitCode:0,signal:null},receipt.stderr);assert.equal(receipt.finished.exitCode,0);return stdout.toString('utf8');
  }catch(e){receipt.error={code:e.code??null,message:e.message};save(id+'.json',receipt);throw e;}
}
async function closeOnce(backend,ws,label){
  phase=label+'-references';const deadline=Date.now()+10000;let prior='';
  for(;;){
    const state=await status(backend,ws),current=JSON.stringify(state,(_,v)=>typeof v==='bigint'?v.toString():v);
    if(current!==prior){closeObservations.push({label,read_at:new Date().toISOString(),state});save('close-observations.json',closeObservations);prior=current;}
    if(state.handles===0n&&state.active===0n&&!state.pendingCommit)break;
    assert.ok(Date.now()<deadline,'original native references did not release for '+label);await new Promise(ok=>setTimeout(ok,20));
  }
  phase=label+'-unmount';const terminal=trusted?await sessions.get(ws.path).unmount(false):await shop.workspace.unmount(ws);assert.equal(terminal.processExit,0);assert.equal(terminal.overlayClosed,true);assert.equal(existsSync(ws.path),false);events.push({label,...terminal});
}
try{
  let init=await runtime.project.start_init('git-project',source,{timeout:20000});const deadline=Date.now()+25000;
  while(!init.ended){assert.ok(Date.now()<deadline);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
  process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global','store.sqlite');shop=await LayerFS.open('git-project');await shop.branch.fork('feature');
  const instance=trusted?null:await runtime.native.create({project:'git-project',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});const residentPid=instance?(await instance.status()).pid:null;
  const registration=instance?await runtime.native.bindClient(shop,instance,{commitScope:'published'}):null,backend=LayerFSBackend.of(shop);
  const a=await createWorkspace(instance,registration);mkdirSync(join(a.path,'repo'));phase='git-create';
  if(process.env.LAYERFS_TEST_GIT_CWD_PROBE){const observer=await execute(a,resolve(process.env.LAYERFS_TEST_GIT_CWD_PROBE),[join(a.path,'repo')],{});const streams=Promise.all([collect(observer.stdout),collect(observer.stderr)]);observer.stdin.end();const exit=await observer.finished;const [stdout,stderr]=await streams;save('cwd-diagnostic.json',{exit,stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8')});}
  const version=(await gitRun(a,['--version'])).trim();await gitRun(a,['init','--initial-branch=main']);
  const repo=join(a.path,'repo'),binary=Buffer.from(Uint8Array.from({length:300023},(_,i)=>(i*19+5)%251));
  writeFileSync(join(repo,'.gitignore'),'ignored/\n');mkdirSync(join(repo,'ignored'));writeFileSync(join(repo,'ignored/cache.bin'),binary);writeFileSync(join(repo,'tracked.txt'),'first native revision\n');
  await gitRun(a,['add','.gitignore','tracked.txt']);await gitRun(a,['commit','-m','native first']);const first=(await gitRun(a,['rev-parse','HEAD'])).trim();assert.match(first,/^[0-9a-f]{40}$/);assert.equal(await gitRun(a,['status','--porcelain']),'');
  writeFileSync(join(repo,'tracked.txt'),'second native revision\n');renameSync(join(repo,'tracked.txt'),join(repo,'renamed.txt'));await gitRun(a,['add','-A']);await gitRun(a,['commit','-m','native second']);const second=(await gitRun(a,['rev-parse','HEAD'])).trim();assert.notEqual(first,second);assert.equal((await gitRun(a,['rev-parse','HEAD^'])).trim(),first);
  assert.equal(await gitRun(a,['status','--porcelain']),'');await gitRun(a,['fsck','--full']);assert.equal((await gitRun(a,['check-ignore','ignored/cache.bin'])).trim(),'ignored/cache.bin');checkpoints.gitCreated=true;
  writeFileSync(join(repo,'staged.txt'),'staged index content\n');await gitRun(a,['add','staged.txt']);writeFileSync(join(repo,'staged.txt'),'unstaged working content\n');writeFileSync(join(repo,'untracked.txt'),'untracked preserved\n');
  const porcelain=await gitRun(a,['status','--porcelain']);assert.equal(porcelain,'AM staged.txt\n?? untracked.txt\n');assert.equal(await gitRun(a,['show',':staged.txt']),'staged index content\n');
  assert.equal(existsSync(join(repo,'.git/index.lock')),false);const before=manifest(repo);save('before-first.json',before);assert.ok(before.some(r=>r.path==='.git/index'));assert.ok(before.some(r=>r.path.startsWith('.git/objects/')));assert.ok(before.some(r=>r.path==='ignored/cache.bin'));checkpoints.indexWorkingStateSaved=true;
  await assert.rejects(shop.fs.read('feature','/repo/renamed.txt'),{code:'NoSuchPath'});assert.equal((await shop.branch.list_commits('feature')).items.length,0);
  phase='first-layerfs-commit';const pub1=await publish(a);assert.equal(pub1.kind,'Committed');checkpoints.firstPublished=true;save('data-checkpoint-first.json',{checkpoints:{...checkpoints},version,gitCommits:[first,second],publication:pub1,files:before.filter(r=>r.kind==='file').length});await closeOnce(backend,a,'first-normal-close');checkpoints.firstNormalClose=true;
  phase='first-remount';const b=await createWorkspace(instance,registration),rebound=join(b.path,'repo');const after=manifest(rebound);save('after-first.json',after);assert.deepEqual(after,before);checkpoints.firstRemountExact=true;
  assert.equal((await shop.fs.read('feature','/repo/renamed.txt')).text,'second native revision\n');assert.equal((await shop.fs.read('feature','/repo/staged.txt')).text,'unstaged working content\n');assert.equal((await shop.fs.stat('feature','/repo/ignored/cache.bin')).size,300023);
  assert.equal((await gitRun(b,['rev-parse','HEAD'])).trim(),second);assert.equal((await gitRun(b,['rev-parse','HEAD^'])).trim(),first);assert.equal(await gitRun(b,['status','--porcelain']),porcelain);assert.equal(await gitRun(b,['show',':staged.txt']),'staged index content\n');
  await gitRun(b,['diff','--stat']);await gitRun(b,['diff','--cached','--stat']);await gitRun(b,['fsck','--full']);assert.equal(await gitRun(b,['show','HEAD:renamed.txt']),'second native revision\n');assert.equal(await gitRun(b,['show',first+':tracked.txt']),'first native revision\n');
  await gitRun(b,['add','-A']);await gitRun(b,['commit','-m','native third']);const third=(await gitRun(b,['rev-parse','HEAD'])).trim();assert.match(third,/^[0-9a-f]{40}$/);assert.notEqual(third,second);assert.equal((await gitRun(b,['rev-parse','HEAD^'])).trim(),second);assert.equal(await gitRun(b,['status','--porcelain']),'');await gitRun(b,['fsck','--full']);
  const beforeSecond=manifest(rebound);save('before-second.json',beforeSecond);phase='second-layerfs-commit';const pub2=await publish(b);assert.equal(pub2.kind,'Committed');assert.equal(pub2.parent,pub1.head);checkpoints.secondPublished=true;
  const history=await shop.branch.list_commits('feature');assert.equal(history.items.length,2);assert.deepEqual(new Set(history.items.map(r=>r.id)),new Set([pub1.head,pub2.head]));save('history.json',history);save('data-checkpoint-second.json',{checkpoints:{...checkpoints},gitCommits:[first,second,third],publication:pub2});await closeOnce(backend,b,'second-normal-close');checkpoints.secondNormalClose=true;
  phase='second-remount';const c=await createWorkspace(instance,registration),finalRepo=join(c.path,'repo');const final=manifest(finalRepo);save('after-second.json',final);assert.deepEqual(final,beforeSecond);checkpoints.secondRemountExact=true;assert.deepEqual(readFileSync(join(finalRepo,'ignored/cache.bin')),binary);
  assert.equal((await gitRun(c,['rev-parse','HEAD'],{readOnly:true})).trim(),third);assert.equal(await gitRun(c,['status','--porcelain'],{readOnly:true}),'');await gitRun(c,['fsck','--full'],{readOnly:true});assert.equal(await gitRun(c,['show','HEAD:staged.txt'],{readOnly:true}),'unstaged working content\n');
  const beforeClose=await status(backend,c);assert.equal(beforeClose.dirtyInodes,0n);assert.equal(beforeClose.dirtyEntries,0n);if(instance)assert.equal((await instance.status()).pid,residentPid);await closeOnce(backend,c,'third-normal-close');checkpoints.thirdNormalClose=true;
  phase='instance-close';if(instance){const terminal=await shop.sandbox.close(registration.sandbox);assert.equal(terminal.tokenClosed,true);assert.equal(terminal.desktopClosed,true);assert.equal(terminal.processExit,0);events.push({label:'instance-closed',...terminal});checkpoints.instanceClosed=true;}
  assert.deepEqual(await runtime.native.list(),[]);assert.deepEqual(await runtime.native.instances(),[]);await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(sha(readFileSync(p)),identity[k]);
  save('observations.json',{version,gitCommits:[first,second,third],publications:[pub1,pub2],firstManifest:before.length,secondManifest:beforeSecond.length,ignoredBytes:binary.length,gitCommands:commands.length,stagedAndUnstagedStatePreserved:true,normalCloses:3,thirdVerificationOptionalLocks:false});phase='complete';console.log('PASS native SDK Git: three commits, staged/unstaged/index/ignored bytes, two LayerFS publications, three exact remount/normal closes and original resident close');
}catch(e){failure={phase,code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped SDK Git lifecycle',read_at:new Date().toISOString(),phase,identity,failure,checkpoints,commands:commands.map(r=>({id:r.id,args:r.args,root:r.root,finished:r.finished})),events,closeObservations,instances:runtime.closed?[]:await runtime.native.instances(),sessions:runtime.closed?[]:await runtime.native.list(),runtime_closed:runtime.closed,mode:trusted?'trusted-local':'restricted-sdk',historicalGitFailUnchanged:true,fullKernelMappingQualification:false});}
