// Public runtime native-instance lifecycle with an independent executable peer.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
const [selected,peer,output]=process.argv.slice(2);const out=resolve(output);assert.equal(existsSync(out),false);mkdirSync(join(out,'volume/global'),{recursive:true});writeFileSync(join(out,'volume/global/store.sqlite'),'external fixture only');
process.env.LAYERFS_INSTANCE_PEER_CASE=selected;process.env.LAYERFS_INSTANCE_PEER_RELEASE=join(out,'release');
const runtime=await LayerFSRuntime.open({home:join(out,'home'),native:true,sweep:false});mkdirSync(join(out,'home/.runtime/projects'),{recursive:true});writeFileSync(join(out,'home/.runtime/projects/example.json'),JSON.stringify({name:'example',volume:join(out,'volume')}));
const p=resolve(peer),input={project:'example',executable:p,host:p,winfsp:p,restrictedLauncher:p,work:join(out,'work')};let failure=null;
try{
 if(selected==='validation'){
  for(const change of [{image:'sha256:x'},{work:'relative'},{readyTimeoutMs:0},{project:'../example'}])await assert.rejects(runtime.native.create({...input,...change}),{code:'InvalidInput'});assert.deepEqual(await runtime.native.instances(),[]);await runtime.close();
 }else if(selected==='setup'){
  await assert.rejects(runtime.native.create(input),e=>e.code==='Failed'&&e.detail.setup===true);
 }else if(['wrong-pid','late'].includes(selected)){
  await assert.rejects(runtime.native.create({...input,...(selected==='late'?{readyTimeoutMs:25}:{})}),{code:'Unknown'});await assert.rejects(runtime.close(),{code:'Unknown'});
 }else{
  const opening=runtime.native.create(input);assert.equal((await runtime.native.instances())[0].state,'starting');await assert.rejects(runtime.close(),{code:'Busy'});
  const instance=await opening;
  if(selected==='legal'||selected==='terminal-live'){
   assert.equal((await instance.status()).state,'running');assert.deepEqual(await runtime.native.list(),[]);
   let settled=false;const close=instance.close().then(v=>{settled=true;return v});
   if(selected==='terminal-live'){await new Promise(ok=>setTimeout(ok,40));assert.equal(settled,false);writeFileSync(join(out,'release'),'close original');}
   const receipt=await close;assert.equal(receipt.processExit,0);assert.equal(receipt.tokenClosed,true);assert.deepEqual(await instance.close(),receipt);await assert.rejects(instance.mount('feature'),{code:'NoSuchSandbox'});assert.deepEqual(await runtime.native.instances(),[]);await runtime.close();
  }else if(selected==='failed-close'){
   await assert.rejects(instance.close(),{code:'Unknown'});await assert.rejects(runtime.close(),{code:'Unknown'});
  }else if(selected==='duplicate-ready'){
   await assert.rejects(instance.status(),{code:'Unknown'});await assert.rejects(runtime.close(),{code:'Unknown'});
  }else if(selected==='duplicate'){
   await instance.status();await assert.rejects(instance.status(),{code:'Unknown'});await assert.rejects(runtime.close(),{code:'Unknown'});
  }else{
   await assert.rejects(instance.status(),{code:'Unknown'});await assert.rejects(instance.mount('feature'),{code:'Unknown'});await assert.rejects(runtime.close(),{code:'Unknown'});
  }
 }
 if(selected==='setup'){assert.deepEqual(await runtime.native.instances(),[]);await runtime.close();}
 console.log('PASS native instance protocol '+selected);
}catch(e){failure={message:e.message,code:e.code??null};throw e;}
finally{writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',selected,failure,instances:runtime.closed?[]:await runtime.native.instances(),actual_token:false},null,2));}
