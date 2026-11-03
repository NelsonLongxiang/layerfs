// status and list_workspaces must describe the same Workspace with the same activity.
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
const home=join(out,'home'),source=join(out,'source');mkdirSync(home);mkdirSync(source);writeFileSync(join(source,'seed.txt'),'activity\n');
const acl=spawnSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who);if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:home},encoding:'utf8',timeout:10000});assert.ifError(acl.error);assert.equal(acl.status,0,acl.stderr);
process.env.LAYERFS_NATIVE=addon;process.env.LAYERFS_HOME=home;
const runtime=await LayerFSRuntime.open({home,native:true,sweep:false});let shop,failure=null;const steps=[];
const agree=async(label,ref,expectActivity)=>{const backend=LayerFSBackend.of(shop);const status=await backend.daemon.workspace.status(ref);const list=await shop.sandbox.list_workspaces(ref.sandbox);const row=list.items.find(i=>resolve(i.path)===resolve(ref.path));assert.ok(row,'list must show the workspace at '+label);assert.equal(status.activity,expectActivity,label+' status activity');assert.equal(row.activity,status.activity,label+' list activity must equal status');assert.equal(row.workspace,status.workspace,label+' workspace id');assert.equal(row.branch,status.branch,label+' branch');assert.equal(row.headMovedSinceMount,status.headMovedSinceMount,label+' headMoved');assert.deepEqual(row.dirty,status.overlay?{inodes:status.overlay.inodes,entries:status.overlay.entries}:row.dirty,label+' dirty');steps.push({label,activity:status.activity,list:row.activity,dirty:row.dirty,inodes:status.overlay.inodes,entries:status.overlay.entries,headMoved:row.headMovedSinceMount});return {status,row};};
try{
 let init=await runtime.project.start_init('activity-agree',source,{timeout:20000});const until=Date.now()+25000;while(!init.ended){assert.ok(Date.now()<until);await new Promise(ok=>setTimeout(ok,20));init=await runtime.project.get_init(init.id);}assert.equal(init.step,'done',JSON.stringify(init.error));
 process.env.LAYERFS_STORE_PATH=join(init.project.volume,'global/store.sqlite');shop=await LayerFS.open('activity-agree');await shop.branch.fork('feature');
 const instance=await runtime.native.create({project:'activity-agree',executable,host,winfsp,restrictedLauncher,work:join(out,'instance')});
 const reg=await runtime.native.bindClient(shop,instance,{commitScope:'published'});
 const ws=await shop.workspace.mount(reg.sandbox,'feature');const ref={sandbox:reg.sandbox,path:ws.path};
 await agree('mounted',ref,'Idle');
 writeFileSync(join(ws.path,'dirty.txt'),'pending change\n');
 const dirty=await agree('dirty',ref,'Idle');assert.ok(dirty.row.dirty.inodes>0,'a written file must show dirty inodes');
 const commit=await shop.workspace.commit(ref,'activity commit');assert.equal(commit.kind,'Committed');
 const after=await agree('committed',ref,'Idle');assert.equal(after.row.headMovedSinceMount,false);
 const again=await shop.workspace.commit(ref,'nothing new');assert.equal(again.kind,'UpToDate');
 await agree('uptodate',ref,'Idle');
 await shop.workspace.unmount(ref,true);const closed=await instance.close();assert.equal(closed.processExit,0);
 await shop.close();shop=undefined;await runtime.close();for(const[k,p]of Object.entries(paths))assert.equal(hash(p),identity[k]);
 console.log('PASS status and list_workspaces agree on activity, workspace, dirty counters and head movement');
}catch(e){failure={code:e.code??null,message:e.message};throw e;}
finally{if(shop)await shop.close().catch(()=>{});save('result.json',{status:failure?'FAIL':'PASS scoped activity agreement',read_at:new Date().toISOString(),identity,failure,steps,runtime_closed:runtime.closed});}
