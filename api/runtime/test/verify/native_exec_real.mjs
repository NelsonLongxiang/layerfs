// Actual registered WinFsp Session with trusted Windows command owners.
// node runtime/test/verify/native_exec_real.mjs <addon> <parent> <host> <WinFsp> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,7);
const [addon,executable,host,winfsp,out]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const identity=Object.fromEntries(Object.entries({addon,executable,host,winfsp,node:process.execPath}).map(([key,path])=>[key,hash(path)]));
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'native exec seed\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);writeFileSync(join(out,'home-acl.json'),JSON.stringify({exit:acl.status,stdout:acl.stdout,stderr:acl.stderr},null,2));
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});
const project='native-exec',branch='feature',events=[];let failure=null,shop;
const options=n=>({executable,host,winfsp,project,branch,work:join(out,n+'-work'),path:join(out,n+'-mount')});
const digest=async(stream)=>{const h=createHash('sha256');let bytes=0;for await(const chunk of stream){h.update(chunk);bytes+=chunk.length;}return {bytes,sha256:h.digest('hex')};};
try{
 let job=await runtime.project.start_init(project,source,{timeout:20000});const initEnd=Date.now()+25000;
 while(!job.ended){assert.ok(Date.now()<initEnd);await new Promise(ok=>setTimeout(ok,20));job=await runtime.project.get_init(job.id);}writeFileSync(join(out,'init.json'),JSON.stringify(job,null,2));assert.equal(job.step,'done',JSON.stringify(job.error));
 process.env.LAYERFS_STORE_PATH=join(job.project.volume,'global','store.sqlite');shop=await LayerFS.open(project);await shop.branch.fork(branch);
 const first=await runtime.native.open(options('first'));await assert.rejects(runtime.close(),{code:'Busy'});
 const script="const fs=require('node:fs');fs.writeFileSync('command.txt','written by native exec\\n');fs.writeFileSync('binary.bin',Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251));(async()=>{for await(const b of process.stdin){await new Promise((ok,no)=>process.stdout.write(b,e=>e?no(e):ok()));await new Promise((ok,no)=>process.stderr.write(b,e=>e?no(e):ok()));}process.exitCode=9})().catch(e=>{process.stderr.write(String(e));process.exitCode=90})";
 const child=await first.exec(process.execPath,['-e',script]);assert.equal(Object.isFrozen(child),true);assert.notEqual(child.pid,(await runtime.native.list())[0].pid);
 const input=Buffer.from(Uint8Array.from({length:2*1024*1024+31},(_,i)=>(i*17)%251)),expected=createHash('sha256').update(input).digest('hex');
 const output=Promise.all([digest(child.stdout),digest(child.stderr)]);child.stdin.end(input);assert.deepEqual(await child.exited,{exitCode:9,signal:null});const receipt=await child.finished;assert.equal(receipt.exitCode,9);assert.equal(receipt.cancellationRequested,false);for(const s of await output)assert.deepEqual(s,{bytes:input.length,sha256:expected});events.push({label:'command',receipt,output:await output});
 assert.equal(readFileSync(join(first.path,'command.txt'),'utf8'),'written by native exec\n');
 // A command's filesystem changes remain unpublished until the explicit Commit.
 await assert.rejects(shop.fs.read(branch,'/command.txt'),{code:'NoSuchPath'});assert.equal((await shop.branch.list_commits(branch)).items.length,0);events.push({label:'no-implicit-commit'});
 assert.equal((await first.commit('published')).changed,true);await shop.close();shop=await LayerFS.open(project);assert.equal((await shop.fs.read(branch,'/command.txt')).text,'written by native exec\n');assert.equal((await shop.branch.list_commits(branch)).items.length,1);
 const marker=join(out,'release-descendant');
 const descendant="const fs=require('node:fs');const file=fs.openSync('command.txt','r');process.stdout.write('descendant-held');process.send({ready:true,pid:process.pid});const t=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(t);fs.closeSync(file);process.exit(0)}},5);setTimeout(()=>process.exit(90),8000).unref()";
 const rootScript="const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',process.argv[2],process.argv[1]],{detached:true,stdio:['ignore',1,2,'ipc']});c.on('error',e=>{process.stderr.write(String(e));process.exit(91)});c.once('message',r=>{require('node:fs').writeFileSync(process.argv[1]+'.ready',JSON.stringify(r));c.disconnect();process.exit(4)})";
 const root=await first.exec(process.execPath,['-e',rootScript,marker,descendant]);const roots=Promise.all([digest(root.stdout),digest(root.stderr)]);root.stdin.end();assert.equal((await root.exited).exitCode,4);assert.equal(JSON.parse(readFileSync(marker+'.ready','utf8')).ready,true);
 assert.equal((await runtime.native.list())[0].commands,1);await assert.rejects(first.unmount(),e=>e.code==='Busy'&&e.detail.serviceKept===true);assert.equal(readFileSync(join(first.path,'command.txt'),'utf8'),'written by native exec\n');events.push({label:'root-exit-not-filesystem-drain',rootExit:4,nativeBusy:true});
 writeFileSync(marker,'release');assert.equal((await root.finished).exitCode,4);assert.equal((await roots)[0].bytes,15);assert.equal((await roots)[1].bytes,0);assert.equal((await runtime.native.list())[0].commands,0);
 readFileSync(join(first.path,'command.txt'));const releaseEnd=Date.now()+8000;for(;;){const state=await first.status();if(state.handles===0n&&state.active===0n)break;assert.ok(Date.now()<releaseEnd);await new Promise(ok=>setTimeout(ok,20));}
 events.push({label:'first-terminal',...await first.unmount()});assert.equal(existsSync(first.path),false);
 const second=await runtime.native.open(options('second'));assert.equal(readFileSync(join(second.path,'command.txt'),'utf8'),'written by native exec\n');assert.deepEqual(readFileSync(join(second.path,'binary.bin')),Buffer.from(Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251)));
 const cancelled=await second.exec(process.execPath,['-e',"process.stdout.write('running');setInterval(()=>{},1000)"]);const cancelStreams=Promise.all([digest(cancelled.stdout),digest(cancelled.stderr)]);cancelled.stdin.end();assert.equal(cancelled.cancel().requested,true);assert.throws(()=>cancelled.cancel(),{code:'Busy'});const cancelledReceipt=await cancelled.finished;await cancelStreams;assert.equal(cancelledReceipt.cancellationRequested,true);await second.status();events.push({label:'explicit-root-cancellation',...cancelledReceipt});
 assert.equal((await second.commit('published')).changed,false);await second.unmount();assert.deepEqual(await runtime.native.list(),[]);await shop.close();shop=undefined;await runtime.close();assert.deepEqual(readdirSync(options('first').work).filter(n=>n.endsWith('.sqlite')&&n!=='native-template.sqlite'),[]);
 for(const[key,path]of Object.entries({addon,executable,host,winfsp,node:process.execPath}))assert.equal(hash(path),identity[key]);
 console.log('PASS actual native exec: raw 2097183-byte stdout/stderr, exit9, no implicit Commit, SDK readback/remount, descendant-held native Busy after root exit, explicit cancellation and independent filesystem terminal');
}catch(error){failure={message:error.message,code:error.code??null};throw error;}
finally{if(shop)await shop.close().catch(()=>{});writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',read_at:new Date().toISOString(),identity,failure,events,owned:runtime.closed?[]:await runtime.native.list(),runtime_closed:runtime.closed,actual_winfsp:true,sandbox_isolation:false,sdk_workspace_supported:false},(_,v)=>typeof v==='bigint'?v.toString():v,2));}
