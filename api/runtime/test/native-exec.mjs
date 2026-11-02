// Public native.exec with real same-user commands and an external protocol peer.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LayerFSRuntime} from '@layerfs/runtime';
const selected=process.argv[2],out=mkdtempSync(resolve('../tmp/native-exec-unit-'));
process.env.NATIVE_RUNTIME_PEER_CASE='normal';process.env.NATIVE_RUNTIME_PEER_LOG=join(out,'peer.json');
const peer=fileURLToPath(new URL('./fixture/native-session-peer.mjs',import.meta.url));
const runtime=await LayerFSRuntime.open({home:join(out,'home'),native:true,sweep:false});
const path=join(out,'mount');mkdirSync(path);
const session=await runtime.native.open({executable:process.execPath,host:peer,winfsp:peer,store:peer,work:join(out,'work'),path:join(out,'fresh-mount'),catalog:Buffer.from('native-exec-peer'),cursor:Buffer.alloc(32,8),branch:'11'+'01'.repeat(16)});
// The peer serves no filesystem. Make its declared mount directory only for
// ordinary-process unit tests, never use these receipts as WinFsp evidence.
mkdirSync(session.path);
const collect=async(stream)=>{const parts=[];for await(const chunk of stream)parts.push(chunk);return Buffer.concat(parts);};
let failure=null;
try{
 if(selected==='stream'){
  const child=await session.exec(process.execPath,['-e',"process.stdin.on('data',b=>{process.stdout.write(b);process.stderr.write(b)});process.stdin.on('end',()=>process.exitCode=7)"]);
  const input=Buffer.from(Uint8Array.from({length:2*1024*1024+31},(_,i)=>(i*17)%251));
  const outputs=Promise.all([collect(child.stdout),collect(child.stderr)]);child.stdin.end(input);
  assert.deepEqual(await child.exited,{exitCode:7,signal:null});
  const [stdout,stderr]=await outputs;assert.deepEqual(stdout,input);assert.deepEqual(stderr,input);assert.equal((await child.finished).exitCode,7);assert.equal((await runtime.native.list())[0].commands,0);
 }else if(selected==='late-consumer'){
  const child=await session.exec(process.execPath,['-e',"process.stdout.write(Buffer.alloc(49153,101));process.stderr.write(Buffer.alloc(49153,102))"]);child.stdin.end();
  assert.equal((await child.exited).exitCode,0);assert.equal((await runtime.native.list())[0].commands,1);
  let settled=false;child.finished.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);
  const [stdout,stderr]=await Promise.all([collect(child.stdout),collect(child.stderr)]);assert.deepEqual(stdout,Buffer.alloc(49153,101));assert.deepEqual(stderr,Buffer.alloc(49153,102));await child.finished;
 }else if(selected==='backpressure'){
  const marker=join(out,'pump');
  const descendant="const fs=require('node:fs');process.send({ready:true});(async()=>{for(let i=0;i<64;i++)await new Promise((ok,no)=>process.stdout.write(Buffer.alloc(65536,73),e=>e?no(e):ok()));fs.writeFileSync(process.argv[1]+'.done','all-written');process.exitCode=0})().catch(()=>process.exit(91));setTimeout(()=>process.exit(90),5000).unref()";
  const script="const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',process.argv[2],process.argv[1]],{detached:true,stdio:['ignore',1,2,'ipc']});c.on('error',()=>process.exit(91));c.once('message',()=>{c.disconnect();process.exit(4)})";
  const child=await session.exec(process.execPath,['-e',script,marker,descendant]);child.stdin.end();assert.equal((await child.exited).exitCode,4);
  const deadline=Date.now()+3000;while(!child.stdout.writableNeedDrain){assert.ok(Date.now()<deadline,'no observed output backpressure');await new Promise(ok=>setTimeout(ok,5));}
  assert.ok(child.stdout.readableLength<=131072);assert.equal(existsSync(marker+'.done'),false);assert.equal((await runtime.native.list())[0].commands,1);
  const [stdout,stderr]=await Promise.all([collect(child.stdout),collect(child.stderr)]);assert.deepEqual(stdout,Buffer.alloc(64*65536,73));assert.equal(stderr.length,0);await child.finished;assert.equal(readFileSync(marker+'.done','utf8'),'all-written');
 }else if(selected==='validation'){
  for(const args of [['relative',[],{}],[process.execPath,['x\0'],{}],[process.execPath,[],{timeout:4}],[process.execPath,[],{env:{a:'1',A:'2'}}],[process.execPath,[],{env:{A:2}}]])await assert.rejects(session.exec(...args),{code:'InvalidInput'});
  assert.equal((await runtime.native.list())[0].commands,0);
 }else if(selected==='spawn-failure'){
  const invalid=join(out,'not-a-program.exe');writeFileSync(invalid,'not PE');await assert.rejects(session.exec(invalid,[]),{code:'Failed'});assert.equal((await runtime.native.list())[0].commands,0);
 }else if(selected==='environment'){
  process.env.LAYERFS_TEST_CAPABILITY='must-not-inherit';process.env.UNRELATED_HOST_SECRET='not-forwarded';
  const child=await session.exec(process.execPath,['-e',"process.stdout.write(JSON.stringify({capability:process.env.LAYERFS_TEST_CAPABILITY??null,other:process.env.UNRELATED_HOST_SECRET??null,explicit:process.env.CASE_VALUE,cwd:process.cwd()}))"],{env:{CASE_VALUE:'explicit value'}});
  const output=collect(child.stdout);const errors=collect(child.stderr);child.stdin.end();await child.finished;assert.deepEqual(JSON.parse((await output).toString()),{capability:null,other:null,explicit:'explicit value',cwd:session.path});assert.equal((await errors).length,0);
 }else if(selected==='cancel'){
  const child=await session.exec(process.execPath,['-e',"process.stdout.write('active');setInterval(()=>{},1000)"]);
  const output=collect(child.stdout),errors=collect(child.stderr);child.stdin.end();
  assert.equal(child.cancel().requested,true);assert.throws(()=>child.cancel(),{code:'Busy'});
  const ended=await child.finished;assert.equal(ended.cancellationRequested,true);assert.equal((await output).includes(Buffer.from('active'))||ended.signal==='SIGTERM',true);await errors;assert.equal(child.cancel().rootExited,true);await session.status();
 }else if(selected==='process-before-streams'){
  const marker=join(out,'release');
  const descendant="const fs=require('node:fs');process.stdout.write('descendant');process.send({ready:true,pid:process.pid});const t=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(t);process.exit(0)}},5);setTimeout(()=>process.exit(90),4000).unref()";
  const script="const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',process.argv[2],process.argv[1]],{detached:true,stdio:['ignore',1,2,'ipc']});c.on('error',e=>{process.stderr.write(String(e));process.exit(91)});c.once('message',r=>{require('node:fs').writeFileSync(process.argv[1]+'.ready',JSON.stringify(r));c.disconnect();process.exit(4)})";
  const child=await session.exec(process.execPath,['-e',script,marker,descendant]);const output=collect(child.stdout),errors=collect(child.stderr);child.stdin.end();
  assert.equal((await child.exited).exitCode,4);assert.equal(JSON.parse(readFileSync(marker+".ready","utf8")).ready,true);assert.equal((await runtime.native.list())[0].commands,1);
  // This protocol peer reports native terminal even while a command owns EOF.
  // Runtime must still retain command custody after the filesystem is closed.
  await session.unmount();await assert.rejects(runtime.close(),{code:'Busy'});assert.equal(runtime.closed,false);
  let ended=false;child.finished.then(()=>ended=true);await Promise.resolve();assert.equal(ended,false);
  writeFileSync(marker,'release');assert.equal((await child.finished).exitCode,4);assert.equal((await output).toString(),'descendant');await errors;assert.deepEqual(await runtime.native.list(),[]);await runtime.close();
 }else if(selected==='output-abandoned'){
  const child=await session.exec(process.execPath,['-e',"process.stdout.write('part');setTimeout(()=>process.exit(0),100)"]);
  const errors=collect(child.stderr);child.stdin.end();child.stdout.destroy();await assert.rejects(child.finished,{code:'Unknown'});await child.exited;await errors;await assert.rejects(runtime.close(),{code:'Unknown'});assert.equal((await runtime.native.list())[0].executionRetained,true);
 }else throw Error('unknown test selection');
 if(!['process-before-streams','output-abandoned'].includes(selected)){await session.unmount();await runtime.close();}
 console.log('PASS native exec '+selected+' evidence='+out);
}catch(error){failure={message:error.message,code:error.code??null};throw error;}
finally{writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',selected,failure,owned:runtime.closed?[]:await runtime.native.list(),actual_winfsp:false,sandbox_isolation:false},null,2));}
