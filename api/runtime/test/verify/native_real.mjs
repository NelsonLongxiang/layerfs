// Public LayerFSRuntime consumer against actual Windows product binaries.
// node runtime/test/verify/native_real.mjs <parent> <host> <WinFsp> <checker> <fresh-output>
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes,createHash} from "node:crypto";
import {existsSync,mkdirSync,writeFileSync,readFileSync,openSync,readSync,closeSync,readdirSync,renameSync} from "node:fs";
import {resolve,join} from "node:path";
import {LayerFSRuntime} from "@layerfs/runtime";
assert.equal(process.platform,"win32");assert.equal(process.argv.length,7);
const [executable,host,winfsp,checker,out]=process.argv.slice(2).map(p=>resolve(p));
assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const identity={executable:hash(executable),host:hash(host),winfsp:hash(winfsp),checker:hash(checker)};
const catalog=Buffer.from("explicit-native-binding-test-v1"),cursor=Buffer.alloc(32,91),branch="11"+"29".repeat(16);
function frame(){const n=Buffer.alloc(2);n.writeUInt16LE(catalog.length);return Buffer.concat([Buffer.from("LFSBND01"),n,catalog,cursor,Buffer.from(branch,"hex"),randomBytes(32)]);}
function cli(name,args,input,env=process.env){const r=spawnSync(checker,args,{input,env,encoding:"utf8",timeout:20000});writeFileSync(join(out,name+".json"),JSON.stringify({exe:checker,args,exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr},null,2));assert.ifError(r.error);assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);return r;}
const fixture=join(out,"fixture");cli("setup",["binding-setup",fixture],frame(),{...process.env,LAYERFS_PROJFS_PROBE_CHILD_ROOT:fixture});
const store=join(fixture,"store.sqlite");
const runtime=await LayerFSRuntime.open({home:join(out,"home"),platform:"windows",native:true,sweep:false});
const events=[];let failure=null,held;
const observed=async(label,s)=>{const value=await s.status();events.push({label,...value});return value;};
const options=(name)=>({executable,host,winfsp,store,work:join(out,name+"-work"),path:join(out,name+"-mount"),catalog,cursor,branch});
let first,second;
try{
 await assert.rejects(runtime.worker.start(),{code:"Unsupported"});
 first=await runtime.native.open(options("first"));
 assert.equal(Object.isFrozen(first),true);assert.equal(typeof first.id,"string");assert.match(first.id,/^[0-9a-f]{64}$/);
 assert.equal((await runtime.native.list()).length,1);
 await assert.rejects(runtime.close(),{code:"Busy"});assert.equal(runtime.closed,false);
 await assert.rejects(first.commit("application-visible"),{code:"Unsupported"});
 const initial=await observed("initial",first);assert.equal(initial.root,1n);assert.equal(initial.prepared,false);
 assert.equal(readFileSync(join(first.path,"alpha.txt"),"utf8"),"old immutable Store version\n");
 mkdirSync(join(first.path,"native"));writeFileSync(join(first.path,"native","original.txt"),"published by standalone product\n");renameSync(join(first.path,"native","original.txt"),join(first.path,"native","renamed.txt"));
 const large=Buffer.from(Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251));writeFileSync(join(first.path,"native","window.bin"),large);assert.deepEqual(readFileSync(join(first.path,"native","window.bin")),large);
 const [state,commit]=await Promise.all([observed("parallel-status",first),first.commit("published")]);
 assert.equal(typeof state.revision,"bigint");assert.equal(commit.changed,true);assert.equal(commit.scope,"published");events.push({label:"published",...commit});
 held=openSync(join(first.path,"native","renamed.txt"),"r");
 await assert.rejects(first.unmount(),e=>e.code==="Busy"&&e.detail.serviceKept===true);
 const bytes=Buffer.alloc(9);assert.equal(readSync(held,bytes,0,9,0),9);assert.equal(bytes.toString(),"published");events.push({label:"busy-io-usable"});closeSync(held);held=undefined;
 readFileSync(join(first.path,"native","renamed.txt"));
 const until=Date.now()+8000;for(;;){const value=await first.status();if(value.handles===0n&&value.active===0n)break;assert.ok(Date.now()<until,"original native Close not observed");await new Promise(ok=>setTimeout(ok,20));}
 const closed=await first.unmount();assert.equal(closed.processExit,0);assert.equal(closed.nativeExit,0);assert.equal(closed.overlayClosed,true);events.push({label:"first-terminal",...closed});
 assert.equal(existsSync(first.path),false);assert.equal(readdirSync(options("first").work).filter(n=>n.endsWith(".sqlite")&&n!=="native-template.sqlite").length,0);
 await assert.rejects(first.status(),{code:"NotMounted"});assert.deepEqual(await runtime.native.list(),[]);
 second=await runtime.native.open(options("second"));assert.notEqual(first.id,second.id);assert.deepEqual(readFileSync(join(second.path,"native","window.bin")),large);assert.equal(readFileSync(join(second.path,"native","renamed.txt"),"utf8"),"published by standalone product\n");
 const unchanged=await second.commit("published");assert.equal(unchanged.changed,false);events.push({label:"unchanged",...unchanged});
 await second.unmount();assert.deepEqual(await runtime.native.list(),[]);await runtime.close();await runtime.close();
 await assert.rejects(runtime.native.open(options("third")),{code:"InvalidInput"});
 const history=cli("history",["service-verify",store],frame());assert.match(history.stdout,/SERVICE_REOPEN_PASS commits=1 parent=None via=Workspace exact_head=true exact_bytes=true readonly=true binary_bytes=300023/);
 for(const[k,p]of Object.entries({executable,host,winfsp,checker}))assert.equal(hash(p),identity[k]);
 console.log("PASS public runtime.native: actual WinFsp product I/O, exact 300023-byte Commit/remount, BigInt status, Busy service retained, correlated process terminal and explicit runtime close");
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(held!==undefined)try{closeSync(held);}catch{}writeFileSync(join(out,"result.json"),JSON.stringify({status:failure?"FAIL":"PASS",read_at:new Date().toISOString(),identity,failure,events,owned:runtime.closed?[]:await runtime.native.list(),runtime_closed:runtime.closed,public_runtime_api:true,product_sdk_workspace_supported:false},(_,v)=>typeof v==="bigint"?v.toString():v,2));}
