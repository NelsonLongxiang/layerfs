// Actual SDK Init + Branch -> registered project.native.open -> native Commit -> SDK reads.
// node runtime/test/verify/registered_native_real.mjs <addon> <parent> <host> <WinFsp> <fresh-output>
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,openSync,readSync,closeSync} from "node:fs";
import {resolve,join} from "node:path";
import {LayerFSRuntime} from "@layerfs/runtime";
import {LayerFS} from "@layerfs/agent";
assert.equal(process.platform,"win32");assert.equal(process.argv.length,7);
const [addon,executable,host,winfsp,out]=process.argv.slice(2).map(p=>resolve(p));
assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const identity=Object.fromEntries(Object.entries({addon,executable,host,winfsp}).map(([k,p])=>[k,hash(p)]));
const home=join(out,"home"),source=join(out,"source");mkdirSync(home);mkdirSync(source);writeFileSync(join(source,"seed.txt"),"registered native input\n");
const acl=spawnSync("pwsh",["-NoProfile","-Command","$ErrorActionPreference='Stop'; $who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name; & icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who); if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:"utf8",timeout:10000});
writeFileSync(join(out,"home-acl.json"),JSON.stringify({exit:acl.status,stdout:acl.stdout,stderr:acl.stderr},null,2));assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});
let failure=null,shop,held;const events=[];const project="registered-project",branch="feature";
const options=(n)=>({executable,host,winfsp,project,branch,work:join(out,n+"-work"),path:join(out,n+"-mount")});
try{
 let job=await runtime.project.start_init(project,source,{timeout:20000});const until=Date.now()+25000;
 while(!job.ended){assert.ok(Date.now()<until,"Init readiness deadline");await new Promise(ok=>setTimeout(ok,20));job=await runtime.project.get_init(job.id);}
 writeFileSync(join(out,"init.json"),JSON.stringify(job,null,2));assert.equal(job.step,"done",JSON.stringify(job.error));
 assert.ok(existsSync(join(home,project,"project.record")));assert.equal(existsSync(join(home,project,"sealed.sqlite")),false);
 const store=join(job.project.volume,"global","store.sqlite");process.env.LAYERFS_STORE_PATH=store;
 shop=await LayerFS.open(project);const fork=await shop.branch.fork(branch);events.push({label:"sdk-fork",result:fork});
 assert.equal((await shop.fs.read(branch,"/seed.txt")).text,"registered native input\n");
 // The caller never opens project.record or obtains catalog/cursor/Branch authority.
 await assert.rejects(runtime.native.open({...options("invalid-main"),branch:"main"}),{code:"InvalidInput"});
 await assert.rejects(runtime.native.open({...options("invalid-mixed"),catalog:Buffer.from("not-exported")}),{code:"InvalidInput"});
 await assert.rejects(runtime.native.open({...options("invalid-project"),project:"not-registered"}),{code:"NoSuchProject"});
 assert.deepEqual(await runtime.native.list(),[]);assert.equal(existsSync(options("invalid-main").work),false);
 const first=await runtime.native.open(options("first"));
 const listed=await runtime.native.list();assert.equal(listed[0].project,project);assert.equal(listed[0].branch,branch);assert.equal(listed[0].state,"serving");assert.equal(Object.hasOwn(listed[0],"catalog"),false);assert.equal(Object.hasOwn(listed[0],"cursor"),false);events.push({label:"registered",id:first.id});
 await assert.rejects(runtime.close(),{code:"Busy"});
 const content="published from registered native runtime\n";writeFileSync(join(first.path,"published.txt"),content);
 const binary=Buffer.from(Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251));writeFileSync(join(first.path,"large.bin"),binary);assert.deepEqual(readFileSync(join(first.path,"large.bin")),binary);
 const publication=await first.commit("published");assert.equal(publication.changed,true);events.push({label:"commit",...publication});
 // Reopen the actual public in-process SDK consumer against the same installed Store.
 await shop.close();shop=await LayerFS.open(project);assert.equal((await shop.fs.read(branch,"/published.txt")).text,content);
 const commits=await shop.branch.list_commits(branch);assert.equal(commits.items.length,1);assert.equal(commits.hasMore,false);assert.equal(commits.items[0].branch,branch);assert.equal(commits.items[0].parent,null);assert.equal(commits.items[0].secondParent,null);assert.equal(commits.items[0].via,"exec");events.push({label:"sdk-commits",result:commits});
 const main=await shop.fs.read("main","/seed.txt");assert.equal(main.text,"registered native input\n");
 held=openSync(join(first.path,"published.txt"),"r");await assert.rejects(first.unmount(),e=>e.code==="Busy"&&e.detail.serviceKept);
 const some=Buffer.alloc(9);assert.equal(readSync(held,some,0,9,0),9);assert.equal(some.toString(),"published");closeSync(held);held=undefined;readFileSync(join(first.path,"published.txt"));
 const release=Date.now()+8000;for(;;){const s=await first.status();if(s.handles===0n&&s.active===0n)break;assert.ok(Date.now()<release,"native original Close not observed");await new Promise(ok=>setTimeout(ok,20));}
 events.push({label:"terminal",...await first.unmount()});assert.equal(existsSync(first.path),false);
 const second=await runtime.native.open(options("second"));assert.deepEqual(readFileSync(join(second.path,"large.bin")),binary);assert.equal(readFileSync(join(second.path,"published.txt"),"utf8"),content);assert.equal((await second.commit("published")).changed,false);await second.unmount();
 await shop.close();shop=undefined;await runtime.close();assert.deepEqual(readdirSync(options("first").work).filter(n=>n.endsWith(".sqlite")&&n!=="native-template.sqlite"),[]);
 for(const[k,p]of Object.entries({addon,executable,host,winfsp}))assert.equal(hash(p),identity[k]);
 console.log("PASS registered runtime native: real SDK Init/fork, owner-private project authority, native published Commit, independent SDK read/History, Busy and remount; no catalog/cursor export");
}catch(error){failure={code:error.code??null,message:error.message};throw error;}
finally{if(held!==undefined)closeSync(held);if(shop)await shop.close().catch(()=>{});writeFileSync(join(out,"result.json"),JSON.stringify({status:failure?"FAIL":"PASS",read_at:new Date().toISOString(),identity,failure,events,owned:runtime.closed?[]:await runtime.native.list(),runtime_closed:runtime.closed,sdk_init_and_store_consumer:true,authority_exported:false,sandbox_workspace_supported:false},(_,v)=>typeof v==="bigint"?v.toString():v,2));}
