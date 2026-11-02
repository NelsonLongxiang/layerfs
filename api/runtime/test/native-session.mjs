// Public runtime native consumer with external inherited-stream peer, not WinFsp.
import assert from "node:assert/strict";
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {LayerFSRuntime} from "@layerfs/runtime";
const selected=process.argv[2];
const work=mkdtempSync(resolve("../tmp/runtime-native-protocol-"));
const marker=join(work,"calls.json");
process.env.NATIVE_RUNTIME_PEER_CASE=selected;process.env.NATIVE_RUNTIME_PEER_LOG=marker;
const peer=fileURLToPath(new URL("./fixture/native-session-peer.mjs",import.meta.url));
const runtime=await LayerFSRuntime.open({home:join(work,"home"),platform:"windows",native:true,sweep:false});
const input={executable:process.execPath,host:peer,winfsp:peer,store:peer,work:join(work,"session-work"),path:join(work,"mount"),catalog:Buffer.from("synthetic-runtime"),cursor:Buffer.alloc(32,12),branch:"11"+"01".repeat(16)};
let session;const started=Date.now();let passed=false;
try{
 if(selected==="validation"){
  const cases=[{path:"relative"},{work:work},{cursor:Buffer.alloc(32)},{branch:"11"+"01".repeat(15)},{catalog:Buffer.alloc(0)},{readyTimeoutMs:0},{sandbox:"1"}];
  for(const change of cases)await assert.rejects(runtime.native.open({...input,...change}),{code:"InvalidInput"});
  assert.deepEqual(await runtime.native.list(),[]);assert.equal(existsSync(marker),false);await runtime.close();
 }else if(selected==="spawn-failure"){
  const executable=join(work,"not-executable.exe");writeFileSync(executable,"not PE");
  await assert.rejects(runtime.native.open({...input,executable}),{code:"Failed"});assert.deepEqual(await runtime.native.list(),[]);await runtime.close();
 }else if(["late-ready","no-ready"].includes(selected)){
  await assert.rejects(runtime.native.open({...input,...(selected==="late-ready"?{readyTimeoutMs:40}:{})}),{code:"Unknown"});
  assert.equal((await runtime.native.list())[0].state,"retained");await assert.rejects(runtime.close(),{code:"Unknown"});
  if(selected==="late-ready"){const end=Date.now()+3000;while(!existsSync(marker+".alive")){assert.ok(Date.now()<end);await new Promise(ok=>setTimeout(ok,10));}assert.equal(readFileSync(marker+".alive","utf8"),"true","readiness failure must not kill original process");}
 }else if(selected==="overlap"){
  const opening=runtime.native.open(input);
  assert.equal((await runtime.native.list())[0].state,"starting");
  await assert.rejects(runtime.close(),{code:"Busy"});
  await assert.rejects(runtime.native.open(input),{code:"Busy"});
  session=await opening;await session.unmount();await runtime.close();
 }else if(selected==="bad-ready"){
  // The first readiness can resolve, but duplicate data must retain ownership.
  try{session=await runtime.native.open(input);await assert.rejects(session.status(),{code:"Unknown"});}catch(e){assert.equal(e.code,"Unknown");}
  await assert.rejects(runtime.close(),{code:"Unknown"});
 }else{
  session=await runtime.native.open(input);assert.equal(Object.isFrozen(session),true);
  await assert.rejects(runtime.close(),{code:"Busy"});assert.equal(runtime.closed,false);
  await assert.rejects(session.commit(),{code:"Unsupported"});assert.equal(existsSync(marker),false);
  if(selected==="busy"){
   await assert.rejects(session.unmount(),{code:"Busy",detail:{session:session.id,status:"80000011",serviceKept:true}});
   const state=await session.status();assert.equal(state.root,1n);assert.equal(state.revision,7n);
   await session.unmount();assert.deepEqual(await runtime.native.list(),[]);await runtime.close();
  }else if(selected==="fragmented"){
   const pending=Promise.all([session.status(),session.commit("published")]);
   await assert.rejects(session.unmount(),{code:"Busy"});
   const [state,result]=await pending;
   assert.equal(state.requests,9n);assert.equal(result.revision,8n);assert.equal(result.scope,"published");
   const terminal=await session.unmount();assert.equal(terminal.processExit,0);await assert.rejects(session.status(),{code:"NotMounted"});await runtime.close();
  }else if(selected==="terminal-without-exit"){
   let finished=false;const ending=session.unmount().then(value=>{finished=true;return value;});
   const end=Date.now()+3000;while(!existsSync(marker+".terminal")){assert.ok(Date.now()<end);await new Promise(ok=>setTimeout(ok,5));}
   assert.equal(finished,false);assert.equal((await runtime.native.list())[0].state,"unmounting");
   writeFileSync(marker+".release","now");assert.equal((await ending).processExit,0);await runtime.close();
  }else if(selected==="duplicate-reply"){
   assert.equal((await session.status()).root,1n);await assert.rejects(session.status(),{code:"Unknown"});await assert.rejects(runtime.close(),{code:"Unknown"});
  }else{
   const action=["failed-terminal","partial-terminal"].includes(selected)?session.unmount():session.status();
   await assert.rejects(action,{code:"Unknown"});await assert.rejects(session.status(),{code:"Unknown"});await assert.rejects(runtime.close(),{code:"Unknown"});
   assert.equal(JSON.parse(readFileSync(marker,"utf8")).calls,1,"uncertain original call not resent");
   if(selected==="reply-eof-live"){const end=Date.now()+3000;while(!existsSync(marker+".alive")){assert.ok(Date.now()<end);await new Promise(ok=>setTimeout(ok,5));}assert.equal(readFileSync(marker+".alive","utf8"),"true");}
  }
 }
 passed=true;console.log("PASS runtime native protocol "+selected+" evidence="+work);
}finally{writeFileSync(join(work,"result.json"),JSON.stringify({status:passed?"PASS":"FAIL",selected,elapsed_ms:Date.now()-started,owned:runtime.closed?[]:await runtime.native.list(),actual_winfsp:false,product_sdk_workspace_supported:false},null,2));}
