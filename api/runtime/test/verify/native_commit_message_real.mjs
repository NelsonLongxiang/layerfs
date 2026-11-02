// Explicit original restricted resident -> SDK Commit metadata -> independent History.
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
const hash=b=>createHash('sha256').update(b).digest('hex'),paths={addon,executable,host,winfsp,restrictedLauncher};const identity=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(readFileSync(p))]));
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2));
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'original metadata seed\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;process.env.LAYERFS_TRACE=join(out,'sdk-trace.jsonl');
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const events=[],publications=[];
try{
 let init=await runtime.project.start_init('commit-messages',source,{timeout:20000});const deadline=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<deadline);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));save('init.json',init);
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('commit-messages');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'commit-messages',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')}),residentPID=(await instance.status()).pid;const registration=await runtime.native.bindClient(shop,instance,{commitScope:'published'}),backend=LayerFSBackend.of(shop);const ws=await shop.workspace.mount(registration.sandbox,'feature');
 const before=await backend.daemon.workspace.status(ws);let invalid=0;
 for(const message of [null,1,{},'x'.repeat(4097),'界'.repeat(1366),'bad\0message','bad\rmessage','\u0085','\ud800']){await assert.rejects(shop.workspace.commit(ws,message),{code:'InvalidInput'});invalid++;}
 await assert.rejects(shop.workspace.commit(ws,'valid force stays refused',true),{code:'Unsupported'});const after=await backend.daemon.workspace.status(ws);assert.deepEqual(after,before);assert.equal((await shop.branch.list_commits('feature')).items.length,0);events.push({label:'before-effect-refusals',invalid,forceRefused:true,workspaceUnchanged:true});
 const selections=[{label:'unicode',message:'SDK metadata 雪😀\n\t 99 unmount discard  trailing  '},{label:'empty',message:''},{label:'maximum',message:'界'.repeat(1365)+'x'},{label:'omitted'},{label:'undefined',message:undefined}];
 for(const [index,selection]of selections.entries()){
  const text='payload-'+selection.label+'\n';writeFileSync(join(ws.path,'message-'+index+'.txt'),text);const expected=selection.message===undefined?'Commit Workspace changes':selection.message;
  const receipt=Object.hasOwn(selection,'message')?await shop.workspace.commit(ws,selection.message):await shop.workspace.commit(ws);assert.equal(receipt.kind,'Committed');assert.equal(receipt.mode,'windows-restricted');assert.equal(receipt.parent,index?publications.at(-1).receipt.head:null);
  const history=await shop.branch.list_commits('feature');assert.equal(history.items.length,index+1);const record=history.items.find(r=>r.id===receipt.head);assert.ok(record);assert.equal(record.message,expected);assert.equal(record.parent,receipt.parent);assert.equal(record.root,receipt.root);assert.equal(record.base,receipt.baseLayer);assert.equal((await shop.fs.read('feature','/message-'+index+'.txt')).text,text);
  const uptodate=await shop.workspace.commit(ws,'metadata alone must not publish '+selection.label+' 雪');assert.equal(uptodate.kind,'UpToDate');assert.equal(uptodate.changed,false);assert.equal(uptodate.head,receipt.head);assert.equal(uptodate.root,receipt.root);const afterHistory=await shop.branch.list_commits('feature');assert.deepEqual(afterHistory,history);assert.equal((await instance.status()).pid,residentPID);
  publications.push({label:selection.label,provided:Object.hasOwn(selection,'message')&&selection.message!==undefined,message:expected,messageBytes:Buffer.byteLength(expected),receipt,uptodate,history});save('publications.json',publications);
 }
 const terminal=await shop.workspace.unmount(ws);assert.equal(terminal.processExit,0);assert.equal(terminal.overlayClosed,true);events.push({label:'normal-terminal',...terminal});
 const fresh=await shop.workspace.mount(registration.sandbox,'feature');for(const [index,selection]of selections.entries())assert.equal(readFileSync(join(fresh.path,'message-'+index+'.txt'),'utf8'),'payload-'+selection.label+'\n');const history=await shop.branch.list_commits('feature');assert.equal(history.items.length,5);for(const publication of publications)assert.equal(history.items.find(r=>r.id===publication.receipt.head).message,publication.message);save('history-after-remount.json',history);
 const freshTerminal=await shop.workspace.unmount(fresh);assert.equal(freshTerminal.processExit,0);events.push({label:'remount-terminal',...freshTerminal});assert.equal((await instance.status()).pid,residentPID);const closed=await shop.sandbox.close(registration.sandbox);assert.equal(closed.tokenClosed,true);assert.equal(closed.desktopClosed,true);assert.equal(closed.processExit,0);events.push({label:'original-instance-terminal',...closed});await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(readFileSync(p)),identity[k]);console.log('PASS original restricted SDK Commit message: exact Unicode/empty/4096/default and no metadata-only history');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped original SDK Commit metadata',read_at:new Date().toISOString(),identity,failure,events,publications,runtime_closed:runtime.closed,sessions:runtime.closed?[]:await runtime.native.list(),instances:runtime.closed?[]:await runtime.native.instances()});}
