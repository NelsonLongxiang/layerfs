// Public resident native execution instance, not an SDK container-image Sandbox.
// <addon> <parent> <host> <WinFsp> <launcher> <access-probe> <fresh-output>
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'resident native context seed\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);writeFileSync(join(out,'acl.json'),JSON.stringify({exit:acl.status,stdout:acl.stdout,stderr:acl.stderr},null,2));
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let failure=null,shop;const events=[];
const collect=async s=>{const parts=[];for await(const b of s)parts.push(b);return Buffer.concat(parts);};
try{
 let job=await runtime.project.start_init('instance-project',source,{timeout:20000});const end=Date.now()+25000;while(!job.ended){assert.ok(Date.now()<end);await new Promise(ok=>setTimeout(ok,20));job=await runtime.project.get_init(job.id);}assert.equal(job.step,'done',JSON.stringify(job.error));writeFileSync(join(out,'init.json'),JSON.stringify(job,null,2));
 const store=join(job.project.volume,'global','store.sqlite');process.env.LAYERFS_STORE_PATH=store;shop=await LayerFS.open('instance-project');await shop.branch.fork('feature');
 const instance=await runtime.native.create({executable,host,winfsp,restrictedLauncher,project:'instance-project',work:join(out,'instance')});assert.equal(Object.isFrozen(instance),true);assert.equal(instance.mode,'windows-restricted');
 const initial=await instance.status();assert.equal(initial.state,'running');assert.equal(initial.sessions,0);events.push({label:'created-running',...initial});assert.equal((await runtime.native.instances()).length,1);await assert.rejects(runtime.close(),{code:'Busy'});
 const first=await instance.mount('feature');
 const observe=async(session)=>{const command=await session.exec(accessProbe,[store]);const streams=Promise.all([collect(command.stdout),collect(command.stderr)]);command.stdin.end();assert.equal((await command.finished).exitCode,7);const [stdout,stderr]=await streams;assert.equal(stderr.length,0);assert.match(stdout.toString(),/TOKEN restricted=1 integrity=4096/);assert.match(stdout.toString(),/READ index=1 allowed=0 error=5/);return /DESKTOP (layerfs-command-[0-9a-f]+)\r?\n/.exec(stdout.toString())?.[1];};
 const firstDesktop=await observe(first);assert.ok(firstDesktop);await assert.rejects(instance.close(),{code:'MountsActive'});assert.equal((await instance.status()).sessions,1);
 const script="const fs=require('node:fs');let denied=false;try{fs.readFileSync(process.argv[1])}catch(e){denied=['EPERM','EACCES'].includes(e.code)}if(!denied)process.exit(81);fs.writeFileSync('resident.txt','written using original resident token\\n');fs.writeFileSync('resident.bin',Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251));process.stdout.write('resident-context-command');process.exitCode=7";
 const command=await first.exec(process.execPath,['-e',script,store]);assert.equal(command.restricted,true);const io=Promise.all([collect(command.stdout),collect(command.stderr)]);command.stdin.end();assert.equal((await command.exited).exitCode,7);const finished=await command.finished;const [stdout,stderr]=await io;assert.equal(stdout.toString(),'resident-context-command');assert.equal(stderr.length,0);events.push({label:'borrowed-original-context',...finished});
 assert.equal((await first.commit('published')).changed,true);await shop.close();shop=await LayerFS.open('instance-project');assert.equal((await shop.fs.read('feature','/resident.txt')).text,'written using original resident token\n');
 const second=await instance.mount('feature');
 const secondDesktop=await observe(second);assert.equal(secondDesktop,firstDesktop);events.push({label:"same-private-desktop",equal:true});
 const invalid=join(out,"not-pe.exe");writeFileSync(invalid,"not a program");await assert.rejects(second.exec(invalid,[]),{code:"Failed"});assert.equal((await instance.status()).pid,initial.pid);assert.equal((await instance.status()).sessions,2);assert.equal((await runtime.native.instances())[0].pid,initial.pid);assert.deepEqual(readFileSync(join(second.path,'resident.bin')),Buffer.from(Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251)));
 const parallel=await second.exec(process.execPath,['-e',"process.stdout.write('second-session');process.exitCode=3"]);const io2=Promise.all([collect(parallel.stdout),collect(parallel.stderr)]);parallel.stdin.end();assert.equal((await parallel.finished).exitCode,3);assert.equal((await io2)[0].toString(),'second-session');
 const cancelled=await second.exec(process.execPath,["-e","setInterval(()=>{},1000)"]);const cancelIO=Promise.all([collect(cancelled.stdout),collect(cancelled.stderr)]);cancelled.stdin.end();assert.equal(cancelled.cancel().requested,true);assert.equal((await cancelled.finished).exitCode,1223);await cancelIO;assert.equal((await instance.status()).pid,initial.pid);events.push({label:"cancel-original-process-handle",exit:1223});
 assert.equal((await second.commit('published')).changed,false);await second.unmount();assert.equal((await instance.status()).sessions,1);await assert.rejects(instance.close(),{code:'MountsActive'});
 events.push({label:'first-terminal',...await first.unmount()});const idle=await instance.status();assert.equal(idle.sessions,0);events.push({label:'instance-idle',...idle});
 const closed=await instance.close();assert.equal(closed.processExit,0);assert.equal(closed.processSignal,null);assert.equal(closed.tokenClosed,true);assert.equal(closed.desktopClosed,true);assert.deepEqual(await instance.close(),closed);events.push({label:'instance-closed',...closed});
 await assert.rejects(instance.mount('feature'),{code:'NoSuchSandbox'});assert.equal(readdirSync(join(out,'instance')).some(s=>s.startsWith('3-')),false,'closed instance must not create a mount or auto-start');assert.deepEqual(await runtime.native.instances(),[]);assert.deepEqual(await runtime.native.list(),[]);await shop.close();shop=undefined;await runtime.close();
 console.log('PASS resident native instance: acknowledged running token/desktop, two mounted Sessions use original token, active-close refusal, SDK Commit/readback and original terminal process exit without mount autostart');
}catch(error){failure={message:error.message,code:error.code??null};throw error;}
finally{if(shop)await shop.close().catch(()=>{});writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',read_at:new Date().toISOString(),identity,failure,events,instances:runtime.closed?[]:await runtime.native.instances(),sessions:runtime.closed?[]:await runtime.native.list(),runtime_closed:runtime.closed,sdk_container_sandbox:false,native_resident_context:true},(_,v)=>typeof v==='bigint'?v.toString():v,2));}
