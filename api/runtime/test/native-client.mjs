// Real SDK clients with external process peers. No Store/WinFsp/token qualification.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
import {LayerFSBackend} from '@layerfs/backend';
import {STATE} from '@layerfs/agent/internal';
const [selected,peer,output]=process.argv.slice(2),out=resolve(output);assert.equal(existsSync(out),false);mkdirSync(join(out,'volume/global'),{recursive:true});const store=join(out,'volume/global/store.sqlite');writeFileSync(store,'external fixture only');
const fake=fileURLToPath(new URL('../../agent/test/fixture/fake-native.cjs',import.meta.url));process.env.LAYERFS_NATIVE=fake;delete process.env.LAYERFS_WORKER_ENDPOINT;process.env.LAYERFS_INSTANCE_PEER_CASE='sdk-guard';
const native=(await import(pathToFileURL(fake).href)).default;
const runtime=await LayerFSRuntime.open({home:join(out,'home'),native:true,sweep:false});mkdirSync(join(out,'home/.runtime/projects'),{recursive:true});writeFileSync(join(out,'home/.runtime/projects/example.json'),JSON.stringify({name:'example',volume:join(out,'volume')}));
process.env.LAYERFS_HOME=join(out,'home');process.env.LAYERFS_STORE_PATH=store;
process.env.NATIVE_RUNTIME_PEER_CASE=['sdk-loss-bootstrap','sdk-loss-state','sdk-loss-publication','sdk-lost-mount'].includes(selected)?selected:'sdk-scope';process.env.NATIVE_RUNTIME_PEER_LOG=join(out,'session-calls.json');
const sessionPeer=fileURLToPath(new URL('./fixture/native-session-peer.mjs',import.meta.url)),p=resolve(peer);
let shop,plain,failure=null;const events=[];
try{
 shop=await LayerFS.open('example');plain=await LayerFS.open('example');
 const instance=await runtime.native.create({project:'example',executable:process.execPath,host:sessionPeer,winfsp:sessionPeer,restrictedLauncher:p,work:join(out,'instance')});
 mkdirSync(join(out,'instance')); // The independent wire peer owns no real workspace.
 if(selected==='scope'){
  await assert.rejects(runtime.native.bindClient(shop,{...instance},{commitScope:'published'}),{code:'NoSuchSandbox'});
  await assert.rejects(runtime.native.bindClient(shop,instance,{}),{code:'InvalidInput'});
  const foreign=await LayerFS.open('foreign');await assert.rejects(runtime.native.bindClient(foreign,instance,{commitScope:'published'}),{code:'Unauthorized'});await foreign.close();
  const secondStore=join(out,'another.sqlite');writeFileSync(secondStore,'not same Store');process.env.LAYERFS_STORE_PATH=secondStore;const wrong=await LayerFS.open('example');process.env.LAYERFS_STORE_PATH=store;await assert.rejects(runtime.native.bindClient(wrong,instance,{commitScope:'published'}),{code:'Unauthorized'});await wrong.close();
  const transport=shop[STATE].transport;shop[STATE].transport={};await assert.rejects(runtime.native.bindClient(shop,instance,{commitScope:'published'}),{code:'Unsupported'});shop[STATE].transport=transport;
 }
 const original=shop[STATE].transport;
 const registration=await runtime.native.bindClient(shop,instance,{commitScope:'published'});assert.equal(registration.mode,'windows-restricted');assert.equal(shop[STATE].transport,original);
 if(selected==='scope'){
  await assert.rejects(runtime.native.bindClient(shop,instance,{commitScope:'published'}),{code:'InvalidInput'});assert.equal((await instance.status()).sessions,0);
  const before=native.calls.length;await shop.branch.fork('feature');assert.equal(native.calls.at(-1),'branch.fork');assert.equal(native.calls.length,before+1);
  const unbound=await plain.workspace.mount('1','feature');assert.equal(unbound.image,'fake-image');assert.equal(unbound.mode,undefined);assert.equal(native.calls.at(-1),'workspace.mount');
  await assert.rejects(shop.workspace.mount('999','feature'),{code:'NoSuchSandbox'});
  const ws=await shop.workspace.mount(registration.sandbox,'feature');assert.equal(ws.mode,'windows-restricted');assert.equal(ws.image,null);assert.equal((await LayerFSBackend.of(shop).daemon.workspace.status(ws)).native.dirtyInodes,1n);
  const publication=await shop.workspace.commit(ws);assert.equal(publication.head,'12'+'ab'.repeat(32));assert.equal(publication.root,'ef'.repeat(32));assert.equal(publication.kind,'Committed');
  await shop.close();shop=undefined;assert.equal((await instance.status()).sessions,1);
  const attached=await LayerFS.open('example');await runtime.native.bindClient(attached,instance,{commitScope:'published'});assert.equal((await attached.sandbox.list_workspaces(registration.sandbox)).items.length,1);await attached.workspace.unmount(ws,true);await attached.sandbox.close(registration.sandbox);await attached.close();await plain.close();plain=undefined;await runtime.close();
 }else if(selected==='capacity'){
  const mounts=[];for(let n=0;n<16;n++)mounts.push(await shop.workspace.mount(registration.sandbox,'feature'));await assert.rejects(shop.workspace.mount(registration.sandbox,'feature'),{code:'Capacity'});assert.equal((await instance.status()).sessions,16);for(const ws of mounts)await shop.workspace.unmount(ws,true);await shop.sandbox.close(registration.sandbox);await shop.close();shop=undefined;await plain.close();plain=undefined;await runtime.close();
 }else{
  let ws;
  if(['sdk-loss-bootstrap','sdk-lost-mount'].includes(selected))await assert.rejects(shop.workspace.mount(registration.sandbox,'feature'),{code:'Unknown'});
  else {ws=await shop.workspace.mount(registration.sandbox,'feature');if(selected==='sdk-loss-state')await assert.rejects(LayerFSBackend.of(shop).daemon.workspace.status(ws),{code:'Unknown'});else await assert.rejects(shop.workspace.commit(ws),{code:'Unknown'});}
  const count=existsSync(join(out,'session-calls.json'))?JSON.parse(readFileSync(join(out,'session-calls.json'),'utf8')).calls:0;
  await assert.rejects(shop.sandbox.list_workspaces(registration.sandbox),{code:'Unknown'});await assert.rejects(shop.sandbox.close(registration.sandbox),{code:'Unknown'});await assert.rejects(runtime.close(),{code:'Unknown'});assert.equal(existsSync(join(out,'session-calls.json'))?JSON.parse(readFileSync(join(out,'session-calls.json'),'utf8')).calls:0,count,'unknown original call was not resent');
  const owner=(await runtime.native.list())[0];assert.equal(owner.state,'retained');events.push({label:'retained-no-replay',sessionCalls:count,owner:owner.state});
 }
 console.log('PASS SDK native route '+selected);
}catch(error){failure={message:error.message,code:error.code??null};throw error;}
finally{for(const c of [shop,plain])if(c)await c.close().catch(()=>{});writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',selected,failure,events,instances:runtime.closed?[]:await runtime.native.instances(),sessions:runtime.closed?[]:await runtime.native.list(),actual_winfsp:false,real_sdk_clients:true,fixture_store_only:true},null,2));}
