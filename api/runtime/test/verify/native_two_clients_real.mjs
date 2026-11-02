// Two independent SDK clients on one original instance: shared owners, independent mounts.
// <addon> <parent> <host> <WinFsp> <resident> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {LayerFSRuntime} from '@layerfs/runtime';
import {LayerFS} from '@layerfs/agent';
import {LayerFSBackend} from '@layerfs/backend';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,8);
const [addon,executable,host,winfsp,restrictedLauncher,out]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),paths={addon,executable,host,winfsp,restrictedLauncher};const identity=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(p)]));
const save=(n,v)=>writeFileSync(join(out,n),JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2));
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'two clients\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;process.env.LAYERFS_TRACE=join(out,'sdk-trace.jsonl');
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let a,b,failure=null;const steps=[],events=[];
try{
 let init=await runtime.project.start_init('two-clients',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');a=await LayerFS.open('two-clients');b=await LayerFS.open('two-clients');await a.branch.fork('feature');
 const instance=await runtime.native.create({project:'two-clients',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')}),residentPID=(await instance.status()).pid;
 const ra=await runtime.native.bindClient(a,instance,{commitScope:'published'}),rb=await runtime.native.bindClient(b,instance,{commitScope:'published'});assert.equal(ra.sandbox,rb.sandbox);assert.equal(ra.mode,'windows-restricted');
 const wa=await a.workspace.mount(ra.sandbox,'feature'),wb=await b.workspace.mount(rb.sandbox,'feature');assert.notEqual(wa.path,wb.path);
 assert.equal((await instance.status()).sessions,2);const listed=await a.sandbox.list_workspaces(ra.sandbox);assert.equal(listed.items.length,2);
 const sa=await LayerFSBackend.of(a).daemon.workspace.status(wa),sb=await LayerFSBackend.of(b).daemon.workspace.status(wb);assert.notEqual(sa.workspace,sb.workspace);assert.equal(sa.branch,'feature');assert.equal(sb.branch,'feature');steps.push({label:'two-mounts',sa,sb,listed:listed.items.length});
 writeFileSync(join(wa.path,'a.txt'),'from a\n');writeFileSync(join(wb.path,'b.txt'),'from b\n');
 const [ca,cb]=await Promise.all([a.workspace.commit(wa,'A concurrent'),b.workspace.commit(wb,'B concurrent')]);assert.equal(ca.kind,'Committed');assert.equal(cb.kind,'Committed');assert.notEqual(ca.head,cb.head);
 const history=await a.branch.list_commits('feature');assert.equal(history.items.length,2);const heads=new Set(history.items.map(h=>h.id));assert.ok(heads.has(ca.head)&&heads.has(cb.head));
 assert.equal((await a.fs.read('feature','/a.txt')).text,'from a\n');assert.equal((await b.fs.read('feature','/b.txt')).text,'from b\n');steps.push({label:'concurrent-commits',ca,cb,history:history.items.map(h=>({id:h.id,parent:h.parent,message:h.message}))});
 // Closing one client leaves the other's registration, mount and writes intact.
 await a.close();a=undefined;
 const afterClose=await LayerFSBackend.of(b).daemon.workspace.status(wb);assert.equal(afterClose.workspace,sb.workspace);assert.equal((await b.sandbox.list_workspaces(rb.sandbox)).items.length,2);
 writeFileSync(join(wb.path,'b2.txt'),'after a close\n');const c2=await b.workspace.commit(wb,'B after A closed');assert.equal(c2.kind,'Committed');steps.push({label:'after-a-close',afterClose,head:c2.head});
 // Any bound client may release an owner of the same original instance.
 const gone=await b.workspace.unmount(wa);assert.equal(gone.processExit,0);assert.equal((await b.sandbox.list_workspaces(rb.sandbox)).items.length,1);
 const endB=await b.workspace.unmount(wb);assert.equal(endB.nativeExit,0);assert.equal(endB.processExit,0);assert.equal(endB.overlayClosed,true);
 const closed=await b.sandbox.close(rb.sandbox);assert.equal(closed.tokenClosed,true);assert.equal(closed.desktopClosed,true);assert.equal(closed.processExit,0);assert.equal(residentPID>0,true);
 await assert.rejects(instance.status(),{code:'NoSuchSandbox'});
 events.push({label:'unmount-and-close',gone,endB,closed});await b.close();b=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS two SDK clients on one instance: shared owners, independent mounts, concurrent commits, close isolation');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{for(const c of [a,b])if(c)await c.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped two-client native ownership',read_at:new Date().toISOString(),identity,failure,steps,events,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),instances:runtime.closed?[]:await runtime.native.instances()});}
