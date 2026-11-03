// Sixteen Workspaces on one instance, each writing and committing concurrently.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'pressure\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;process.env.LAYERFS_TRACE=join(out,'sdk-trace.jsonl');
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let a,b,failure=null;const steps=[],events=[];
try{
 let init=await runtime.project.start_init('pressure',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');a=await LayerFS.open('pressure');b=await LayerFS.open('pressure');await a.branch.fork('feature');
 const instance=await runtime.native.create({project:'pressure',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')}),residentPID=(await instance.status()).pid;
 const ra=await runtime.native.bindClient(a,instance,{commitScope:'published'}),rb=await runtime.native.bindClient(b,instance,{commitScope:'published'});
 const mounts=[];
 for(let n=0;n<16;n++)mounts.push(await (n%2?a:b).workspace.mount((n%2?ra:rb).sandbox,'feature'));
 assert.equal((await instance.status()).sessions,16);
 for(const [n,m] of mounts.entries())writeFileSync(join(m.path,'f'+n+'.txt'),'payload '+n+'\n');
 const started=Date.now();
 const receipts=await Promise.all(mounts.map((m,n)=>(n%2?a:b).workspace.commit(m,'concurrent '+n)));
 const elapsedMs=Date.now()-started;
 for(const [n,r] of receipts.entries()){assert.equal(r.kind,'Committed','commit '+n);assert.equal(r.mode,'windows-restricted');}
 assert.equal(new Set(receipts.map(r=>r.head)).size,16);
 const history=await a.branch.list_commits('feature',100);assert.equal(history.items.length,16);
 assert.deepEqual(new Set(history.items.map(h=>h.message)),new Set(Array.from({length:16},(_,n)=>'concurrent '+n)));
 for(const [n,r] of receipts.entries()){const row=history.items.find(h=>h.id===r.head);assert.ok(row,'history row '+n);assert.equal(row.root,r.root);assert.equal((await a.fs.read('feature','/f'+n+'.txt')).text,'payload '+n+'\n');}
 steps.push({label:'sixteen-concurrent-commits',elapsedMs,heads:16,history:history.items.length});
 const terminals=[];
 for(const [n,m] of mounts.entries()){const t=await (n%2?a:b).workspace.unmount(m,true);assert.equal(t.nativeExit,0);assert.equal(t.processExit,0);assert.equal(t.overlayClosed,true);terminals.push(t.nativeExit);}
 assert.equal((await instance.status()).sessions,0);
 const closed=await a.sandbox.close(ra.sandbox);assert.equal(closed.tokenClosed,true);assert.equal(closed.desktopClosed,true);assert.equal(closed.processExit,0);assert.equal(residentPID>0,true);await assert.rejects(instance.status(),{code:'NoSuchSandbox'});
 events.push({label:'terminals',workspaces:16,closed});await a.close();a=undefined;await b.close();b=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native 16 concurrent commits: all Committed, 16 distinct heads, 16 history rows, clean terminals');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{for(const c of [a,b])if(c)await c.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped native concurrent pressure',read_at:new Date().toISOString(),identity,failure,steps,events,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),instances:runtime.closed?[]:await runtime.native.instances()});}
