// Reversible native close proof; node tools/winfsp-close-test.mjs <host> <WinFsp-dll> <Rust-dll> <client> <fresh-output>.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function analyze(provider,application){
 const rows=[...provider.matchAll(/NORMAL_CLOSE_REFUSED phase=(\d+) status=80000011 files=(\d+) directories=(\d+) commit=(\d+) capture=(\d+) prepared=0 service_kept=true/g)].map(m=>m.slice(1).map(Number));
 assert.deepEqual(rows.map(r=>r[0]),[0,1,2,3]);assert.ok(rows[0][1]>0&&rows[1][2]>0&&rows[2][1]>0&&rows[3][1]>0);
 assert.deepEqual([...application.matchAll(/CLOSE_CLIENT phase=(\d+) /g)].map(m=>Number(m[1])),[0,1,2,3]);
 for(const pattern of [/phase=0 file_held=true io_after_refusal=true/,/phase=1 directory_held=true io_after_refusal=true/,/phase=2 view_held=true file_held=true section_handle_closed=true io_after_refusal=true/,/phase=3 view_only=true file_and_section_closed=true mapped_write_after_refusal=true/,/CLOSE_CLIENT_PASS phases=4 references_released=true ordinary_read_after_unmap=true no_flush=true/])assert.match(application,pattern);
 const stages=['NORMAL_CLOSE_REFUSED phase=0 ','NORMAL_CLOSE_REFUSED phase=1 ','NORMAL_CLOSE_REFUSED phase=2 ','NORMAL_CLOSE_REFUSED phase=3 ','NORMAL_CLOSE_REFUSED request=stop service_kept=true','NORMAL_CLOSE_IDLE','NORMAL_CLOSE_PREPARED','NORMAL_CLOSE_STOP_BEGIN','NORMAL_CLOSE_DISPATCHER_DRAINED','OVERLAY_CLOSED','NORMAL_CLOSE_DONE'];
 let at=-1;for(const marker of stages){const next=provider.indexOf(marker);assert.ok(next>at,'ordered close marker '+marker);assert.equal(provider.indexOf(marker,next+marker.length),-1,'duplicate marker '+marker);at=next;}
 assert.match(provider,/NORMAL_CLOSE_PREPARED tracked_references=0 commit=false capture=false admission_fenced=true/);
 assert.match(provider,/NORMAL_CLOSE_DONE detach=true overlay_closed=true/);assert.match(provider,/errors=0/);
 return rows;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
if(process.argv[2]==='--self-test'){
 const raw=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));const p=raw.provider.stdout,a=raw.application.stdout;
 analyze(p,a);console.log('PASS actual reversible close trace');
 const cases=[
 ['missing held-view refusal',p.replace(/^NORMAL_CLOSE_REFUSED phase=3 .*\r?\n/m,''),a],
 ['wrong Busy status',p.replace('status=80000011','status=c00000aa'),a],
 ['premature preparation',p.replace('prepared=0 service_kept=true','prepared=1 service_kept=true'),a],
 ['stop before refusals','NORMAL_CLOSE_STOP_BEGIN prepared=true\n'+p,a],
 ['missing native drain',p.replace('NORMAL_CLOSE_DISPATCHER_DRAINED','UNPROVED_DRAIN'),a],
 ['duplicate stop attempt',p+'\nNORMAL_CLOSE_STOP_BEGIN prepared=true\n',a],
 ['continued view write unproved',p,a.replace('mapped_write_after_refusal=true','mapped_write_after_refusal=false')],
 ];
 for(const [name,pv,av]of cases){assert.throws(()=>analyze(pv,av),name);console.log('PASS reject '+name);}
 process.exit(0);
}
assert.equal(process.platform,'win32');assert.equal(process.argv.length,7);
const [host,dll,bridge,client,out]=process.argv.slice(2).map(p=>resolve(p));
assert.ok(!existsSync(out),'never overwrite proof');mkdirSync(out);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const identity={host:sha(host),winfsp:sha(dll),bridge:sha(bridge),client:sha(client)};
const refused=spawnSync(client,['close-child',out],{encoding:'utf8',timeout:5000});
writeFileSync(join(out,'direct-refusal.json'),JSON.stringify({exit:refused.status,stdout:refused.stdout,stderr:refused.stderr},null,2));
assert.ifError(refused.error);assert.equal(refused.status,1);assert.match(refused.stderr,/requires diagnostic parent/);
function launch(exe,args,env=process.env){
 const record={exe,args,started:new Date().toISOString(),stdout:'',stderr:'',exit:null,error:null};
 const child=spawn(exe,args,{env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>{record.stdout+=d;});child.stderr.on('data',d=>{record.stderr+=d;});
 const ended=new Promise(resolve=>{child.once('error',e=>{record.error=e.message;resolve(record);});child.once('exit',(code,signal)=>{record.exit={code,signal};record.finished=new Date().toISOString();resolve(record);});});
 return {child,record,ended};
}
const mount=join(out,'mount'),control=join(out,'control');
const provider=launch(host,[dll,mount,control,bridge,'--close-boundary']);let app=null,failure=null,held;
const timer=setTimeout(()=>{failure='close proof exceeded 50 seconds';if(app)app.child.kill();provider.child.kill();},50000);
async function phase(name){const until=Date.now()+12000;while(!existsSync(join(control,name))){assert.equal(provider.record.exit,null,provider.record.stdout+provider.record.stderr);assert.equal(provider.record.error,null);assert.ok(Date.now()<until,'phase deadline '+name);await new Promise(r=>setTimeout(r,5));}}
try{
 await phase('ready');
 app=launch(client,['close-child',out],{...process.env,LAYERFS_PROJFS_PROBE_CHILD_ROOT:out});
 const result=await app.ended;assert.equal(result.exit?.code,0,result.stdout+result.stderr);assert.equal(result.exit?.signal,null);
 assert.match(result.stdout,/CLOSE_CLIENT_PASS phases=4 references_released=true/);
 // A real terminal request with a held external reference must also refuse,
 // not just the phase-specific observations. Its single request is consumed.
 held=openSync(join(mount,'alpha.txt'),'r');
 writeFileSync(join(control,'stop'),'stop',{flag:'wx'});await phase('stop-refused');
 assert.equal(readFileSync(join(mount,'alpha.txt'),'utf8'),'old immutable Store version\n');
 assert.equal(provider.record.exit,null);assert.ok(existsSync(mount));
 assert.doesNotMatch(provider.record.stdout,/NORMAL_CLOSE_STOP_BEGIN|NORMAL_CLOSE_DONE/);
 closeSync(held);held=undefined;
 // Readiness observation only. We issue a new explicit close once the adapter
 // has received its exact Close callbacks; this does not retry the refused call.
 writeFileSync(join(control,'close-inspect'),'inspect',{flag:'wx'});await phase('close-idle');
 writeFileSync(join(control,'stop-after-release'),'new request',{flag:'wx'});
 const stopped=await provider.ended;assert.equal(stopped.exit?.code,0,stopped.stdout+stopped.stderr);assert.equal(stopped.exit?.signal,null);
 analyze(stopped.stdout,result.stdout);assert.equal(existsSync(mount),false);
 for(const [key,path]of Object.entries({host,winfsp:dll,bridge,client}))assert.equal(sha(path),identity[key]);
 console.log('PASS reversible close: file/dir/view/view-only and held-reference stop refuse before detach; I/O stays usable; release then explicit new close drains and removes mount');
}catch(e){failure=String(e);if(held!==undefined){try{closeSync(held);}catch{}}
 for(const p of [app,provider])if(p&&p.child.exitCode===null&&!p.child.killed)p.child.kill();await Promise.all([app?.ended,provider.ended]);throw e;
}finally{clearTimeout(timer);writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',identity,failure,provider:provider.record,application:app?.record??null,workspace_qualified:false,general_section_inventory:false},null,2));}
}
