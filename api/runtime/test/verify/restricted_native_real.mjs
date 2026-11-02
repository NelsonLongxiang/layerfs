// Actual protected SDK project -> restricted command -> WinFsp data + backend denial.
// <addon> <parent> <host> <WinFsp> <restricted-launcher> <access-probe> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,9);
const [addon,executable,host,winfsp,restrictedLauncher,accessProbe,out]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const identity=Object.fromEntries(Object.entries({addon,executable,host,winfsp,restrictedLauncher,accessProbe}).map(([k,p])=>[k,hash(p)]));
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'restricted native seed\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});
const project='restricted-project',branch='feature',events=[];let failure=null,shop;
const options=n=>({executable,host,winfsp,restrictedLauncher,project,branch,work:join(out,n+'-work'),path:join(out,n+'-mount')});
const collect=async(s)=>{const parts=[];for await(const b of s)parts.push(b);return Buffer.concat(parts);};
try{
 let job=await runtime.project.start_init(project,source,{timeout:20000});const end=Date.now()+25000;while(!job.ended){assert.ok(Date.now()<end);await new Promise(ok=>setTimeout(ok,20));job=await runtime.project.get_init(job.id);}assert.equal(job.step,'done',JSON.stringify(job.error));writeFileSync(join(out,'init.json'),JSON.stringify(job,null,2));
 const store=join(job.project.volume,'global','store.sqlite');process.env.LAYERFS_STORE_PATH=store;shop=await LayerFS.open(project);await shop.branch.fork(branch);
 const session=await runtime.native.open(options('first'));assert.equal((await runtime.native.list())[0].restricted,true);
 const privateFiles=[store,join(home,project,'project.record'),...readdirSync(options('first').work).filter(n=>n.endsWith('.sqlite')).map(n=>join(options('first').work,n))];assert.ok(privateFiles.length>=4);const privateHash=hash(join(home,project,'project.record'));
 const quoting=["", "space and 雪", "quote\"inside", "trailing\\", "slashes\\\"quoted"];
 const argsCheck=await session.exec(process.execPath,["-e","process.stdout.write(JSON.stringify(process.argv.slice(1)))",...quoting]);const argsStreams=Promise.all([collect(argsCheck.stdout),collect(argsCheck.stderr)]);argsCheck.stdin.end();await argsCheck.finished;const [argsOut,argsErr]=await argsStreams;assert.deepEqual(JSON.parse(argsOut.toString()),quoting);assert.equal(argsErr.length,0);events.push({label:"argv-exact",arguments:quoting.length});
 const parentPid=(await runtime.native.list())[0].pid;
 const access=await session.exec(accessProbe,[...privateFiles,"--process",String(parentPid),"--process",String(process.pid)]);
 const accessStreams=Promise.all([collect(access.stdout),collect(access.stderr)]);access.stdin.end();assert.equal((await access.finished).exitCode,7);
 const [accessOut,accessErr]=await accessStreams;events.push({label:"native-access-check",stdout:accessOut.toString(),stderr:accessErr.toString()});
 assert.equal(accessErr.length,0);assert.match(accessOut.toString(),/TOKEN restricted=1 integrity=4096 bcrypt=00000000 rtl=1/);assert.match(accessOut.toString(),/LAUNCHER allowed=0 error=5/);assert.match(accessOut.toString(),/LAUNCHER_TOKEN allowed=0 error=5/);
 assert.equal((accessOut.toString().match(/READ index=[0-9]+ allowed=0 error=5/g)??[]).length,privateFiles.length);
 assert.equal((accessOut.toString().match(/ALTER index=[0-9]+ allowed=0 error=5/g)??[]).length,privateFiles.length);
 assert.equal((accessOut.toString().match(/PROCESS allowed=0 error=5/g)??[]).length,2);assert.equal((accessOut.toString().match(/PROCESS_TOKEN allowed=0 error=5/g)??[]).length,2);
 const script="const fs=require('node:fs');const denied=JSON.parse(process.argv[1]).map(path=>{try{fs.readFileSync(path);return {path,denied:false}}catch(e){return {path,denied:true,code:e.code}}});fs.writeFileSync('restricted.txt','restricted command wrote here\\n');fs.writeFileSync('restricted.bin',Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251));process.stdout.write(JSON.stringify({denied,cwd:process.cwd(),env:process.env.LAYERFS_HOME??null}));process.exitCode=7";
 const invalid=join(out,"not-executable.exe");writeFileSync(invalid,"not PE");await assert.rejects(session.exec(invalid,[]),{code:"Failed"});assert.equal((await runtime.native.list())[0].commands,0);
 const command=await session.exec(process.execPath,['-e',script,JSON.stringify(privateFiles)]);assert.equal(command.restricted,true);const streams=Promise.all([collect(command.stdout),collect(command.stderr)]);command.stdin.end();const root=await command.exited;const terminal=await command.finished;const [stdout,stderr]=await streams;events.push({label:'restricted-root',root,terminal,stdout:stdout.toString(),stderr:stderr.toString()});
 assert.equal(root.exitCode,7);assert.equal(root.signal,null);assert.equal(terminal.restricted,true);assert.equal(stderr.length,0);const observation=JSON.parse(stdout.toString());assert.equal(observation.cwd,session.path);assert.equal(observation.env,null);assert.ok(observation.denied.every(d=>d.denied&&['EACCES','EPERM'].includes(d.code)),JSON.stringify(observation));assert.equal(hash(join(home,project,'project.record')),privateHash);
 assert.equal(readFileSync(join(session.path,'restricted.txt'),'utf8'),'restricted command wrote here\n');const binary=Buffer.from(Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251));assert.deepEqual(readFileSync(join(session.path,'restricted.bin')),binary);
 await assert.rejects(shop.fs.read(branch,'/restricted.txt'),{code:'NoSuchPath'});assert.equal((await session.commit('published')).changed,true);await shop.close();shop=await LayerFS.open(project);assert.equal((await shop.fs.read(branch,'/restricted.txt')).text,'restricted command wrote here\n');assert.equal((await shop.branch.list_commits(branch)).items.length,1);
 events.push({label:'native-terminal',...await session.unmount()});const second=await runtime.native.open(options('second'));assert.deepEqual(readFileSync(join(second.path,'restricted.bin')),binary);
 const cancelled=await second.exec(process.execPath,['-e',"process.stdout.write('alive');setInterval(()=>{},1000)"]);const cs=Promise.all([collect(cancelled.stdout),collect(cancelled.stderr)]);cancelled.stdin.end();assert.equal(cancelled.cancel().requested,true);const cexit=await cancelled.exited;const done=await cancelled.finished;await cs;assert.equal(cexit.exitCode,1223);assert.equal(cexit.signal,null);assert.equal(done.restricted,true);await second.status();events.push({label:'cancelled',cexit,done});
 assert.equal((await second.commit('published')).changed,false);await second.unmount();await shop.close();shop=undefined;await runtime.close();assert.deepEqual(await runtime.native.list().catch(e=>e.code==='InvalidInput'?[]:Promise.reject(e)),[]);
 console.log('PASS restricted native: low restricted command writes WinFsp, Store/Overlay/project authority denied, exact Commit/SDK/remount, root cancel1223 without filesystem termination');
}catch(error){failure={code:error.code??null,message:error.message};throw error;}
finally{if(shop)await shop.close().catch(()=>{});writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',read_at:new Date().toISOString(),identity,failure,events,owned:runtime.closed?[]:await runtime.native.list(),runtime_closed:runtime.closed,sdk_sandbox_supported:false,restricted_boundary:true},(_,v)=>typeof v==='bigint'?v.toString():v,2));}
