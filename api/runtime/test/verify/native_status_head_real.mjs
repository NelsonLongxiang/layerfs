// Native status observes the client's own Store head; it never guesses from base.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'status seed\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;process.env.LAYERFS_TRACE=join(out,'sdk-trace.jsonl');
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[],events=[];
try{
 let init=await runtime.project.start_init('status-head',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('status-head');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'status-head',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')}),residentPID=(await instance.status()).pid;const registration=await runtime.native.bindClient(shop,instance,{commitScope:'published'}),backend=LayerFSBackend.of(shop);
 const a=await shop.workspace.mount(registration.sandbox,'feature'),b=await shop.workspace.mount(registration.sandbox,'feature');
 const emptyA=await backend.daemon.workspace.status(a),emptyB=await backend.daemon.workspace.status(b);
 assert.equal(emptyA.branch,'feature');assert.equal(emptyA.base,null);assert.equal(emptyA.branchHead,null);assert.equal(emptyA.headMovedSinceMount,false);
 assert.deepEqual({head:emptyB.branchHead,moved:emptyB.headMovedSinceMount},{head:null,moved:false});steps.push({label:'empty-branch',emptyA,emptyB});
 writeFileSync(join(a.path,'a.txt'),'from a\n');const first=await shop.workspace.commit(a,'A first');assert.equal(first.kind,'Committed');
 const aAfter=await backend.daemon.workspace.status(a),bAfter=await backend.daemon.workspace.status(b);
 assert.equal(aAfter.branchHead,first.head);assert.equal(aAfter.headMovedSinceMount,false);assert.equal(aAfter.base,first.head);
 assert.equal(bAfter.branchHead,first.head);assert.equal(bAfter.headMovedSinceMount,true);assert.equal(bAfter.base,null);
 const listed=(await shop.sandbox.list_workspaces(registration.sandbox)).items;const rowA=listed.find(x=>x.path===a.path),rowB=listed.find(x=>x.path===b.path);assert.ok(rowA&&rowB);
 assert.equal(rowA.headMovedSinceMount,false);assert.equal(rowB.headMovedSinceMount,true);assert.equal(rowB.branch,'feature');steps.push({label:'after-a-commit',aAfter,bAfter,listed});
 writeFileSync(join(b.path,'b.txt'),'from b\n');const second=await shop.workspace.commit(b,'B merged');assert.equal(second.kind,'Committed');assert.deepEqual(second.merged,{from:null,head:first.head});
 const aFinal=await backend.daemon.workspace.status(a),bFinal=await backend.daemon.workspace.status(b);
 assert.equal(bFinal.branchHead,second.head);assert.equal(bFinal.headMovedSinceMount,false);assert.equal(bFinal.base,second.head);
 assert.equal(aFinal.branchHead,second.head);assert.equal(aFinal.headMovedSinceMount,true);assert.equal(aFinal.base,first.head);
 const listedFinal=(await shop.sandbox.list_workspaces(registration.sandbox)).items;assert.equal(listedFinal.find(x=>x.path===a.path).headMovedSinceMount,true);assert.equal(listedFinal.find(x=>x.path===b.path).headMovedSinceMount,false);
 steps.push({label:'after-b-merge',aFinal,bFinal,listedFinal,second});
 for(const [ws,label] of [[a,'a-close'],[b,'b-close']]){const terminal=await shop.workspace.unmount(ws);assert.equal(terminal.nativeExit,0);assert.equal(terminal.processExit,0);assert.equal(terminal.overlayClosed,true);events.push({label,...terminal});}
 assert.equal((await instance.status()).pid,residentPID);const closed=await shop.sandbox.close(registration.sandbox);assert.equal(closed.tokenClosed,true);assert.equal(closed.desktopClosed,true);assert.equal(closed.processExit,0);events.push({label:'instance-close',...closed});
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS native status observes Branch head: null base observed, moved detection and merge convergence');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped native status head observation',read_at:new Date().toISOString(),identity,failure,steps,events,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),instances:runtime.closed?[]:await runtime.native.instances()});}
