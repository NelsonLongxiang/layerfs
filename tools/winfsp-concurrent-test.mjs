// Deterministic native Commit interleaving; node tools/winfsp-concurrent-test.mjs <host> <WinFsp-dll> <Rust-dll> <client> <fresh-output>.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,readSync,writeSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,7);
const [host,dll,bridge,client,out]=process.argv.slice(2).map(p=>resolve(p));
assert.ok(!existsSync(out),'never overwrite proof');mkdirSync(out);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const identity={host:sha(host),winfsp:sha(dll),bridge:sha(bridge),client:sha(client)};
const refusal=spawnSync(client,['hold-lane',out],{encoding:'utf8',timeout:5000});
writeFileSync(join(out,'guard-refusal.json'),JSON.stringify({exit:refusal.status,stdout:refusal.stdout,stderr:refusal.stderr},null,2));
assert.ifError(refusal.error);assert.equal(refusal.status,1);assert.match(refusal.stderr,/requires its diagnostic parent/);
function launch(exe,args,env=process.env){
 const record={exe,args,started:new Date().toISOString(),stdout:'',stderr:'',exit:null,error:null};
 const child=spawn(exe,args,{env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>{record.stdout+=d;});child.stderr.on('data',d=>{record.stderr+=d;});
 const ended=new Promise(resolve=>{child.once('error',e=>{record.error=e.message;resolve(record);});child.once('exit',(code,signal)=>{record.exit={code,signal};record.finished=new Date().toISOString();resolve(record);});});
 return {child,record,ended};
}
const mount=join(out,'mount'),control=join(out,'control');
const provider=launch(host,[dll,mount,control,bridge,'--concurrent']);let lane=null,failure=null,held;
const timeout=setTimeout(()=>{failure='concurrent proof exceeded 55 seconds';if(lane)lane.child.kill();provider.child.kill();},55000);
async function phase(name,ms=12000){const until=Date.now()+ms;while(!existsSync(join(control,name))){assert.equal(provider.record.exit,null,provider.record.stdout+provider.record.stderr);assert.equal(provider.record.error,null);if(lane)assert.equal(lane.record.error,null);assert.ok(Date.now()<until,'phase deadline: '+name);await new Promise(r=>setTimeout(r,5));}}
try{
 await phase('ready');
 const file=join(mount,'concurrent.txt');writeFileSync(file,'before commit',{flag:'wx'});held=openSync(file,'r+');
 lane=launch(client,['hold-lane',control],{...process.env,LAYERFS_PROJFS_PROBE_CHILD_ROOT:control});
 await phase('lane-ready');writeFileSync(join(control,'concurrent-start'),'start',{flag:'wx'});
 await phase('concurrent-captured',8000);assert.equal(lane.record.exit,null,'lane holder must still be active');
 const startWrite=new Date().toISOString();
 writeSync(held,Buffer.from('during commit'),0,13,0);const bytes=Buffer.alloc(13);readSync(held,bytes,0,13,0);assert.equal(bytes.toString(),'during commit');
 writeFileSync(join(mount,'late-during.txt'),'new generation',{flag:'wx'});
 assert.equal(readFileSync(join(mount,'late-during.txt'),'utf8'),'new generation');
 writeFileSync(join(control,'concurrent-writes'),'writes',{flag:'wx'});await phase('concurrent-writes-seen',8000);
 const doneWrite=new Date().toISOString();assert.equal(lane.record.exit,null,'ordinary calls must finish before the test writer lane releases');
 writeFileSync(join(control,'lane-release'),'release',{flag:'wx'});const release=await lane.ended;
 assert.equal(release.exit?.code,0,release.stdout+release.stderr);assert.equal(release.exit?.signal,null);assert.match(release.stdout,/LANE_HELD existing_public_port=true history_publications=0/);assert.match(release.stdout,/LANE_RELEASED requested=true/);
 await phase('concurrent-installed');
 const installed=Buffer.alloc(13);readSync(held,installed,0,13,0);assert.equal(installed.toString(),'during commit');
 assert.equal(readFileSync(join(mount,'late-during.txt'),'utf8'),'new generation');
 writeSync(held,Buffer.from('after! commit'),0,13,0);closeSync(held);held=undefined;
 assert.equal(readFileSync(file,'utf8'),'after! commit');
 writeFileSync(join(control,'concurrent-second'),'publish',{flag:'wx'});await phase('concurrent-second-done');
 writeFileSync(join(control,'commit-unchanged'),'publish',{flag:'wx'});await phase('committed-unchanged');
 writeFileSync(join(control,'close-inspect'),'inspect',{flag:'wx'});await phase('close-idle');
 writeFileSync(join(control,'stop'),'stop',{flag:'wx'});const stopped=await provider.ended;
 assert.equal(stopped.exit?.code,0,stopped.stdout+stopped.stderr);assert.equal(stopped.exit?.signal,null);
 assert.match(stopped.stdout,/CONCURRENT_CAPTURE .*duplicate_commit=Busy capture=Busy close=Busy/);
 const cross=/CONCURRENT_WRITES_CONFIRMED captured=(\d+) active=(\d+) capture_revision=(\d+) later_revision=(\d+) commit_still_running=true/.exec(stopped.stdout);
 assert.ok(cross,stopped.stdout);assert.ok(Number(cross[2])>Number(cross[1]));assert.ok(Number(cross[4])>Number(cross[3]));
 assert.match(stopped.stdout,/CONCURRENT_INSTALL_PASS old_commit_fixed=true later_live_preserved=true/);
 assert.match(stopped.stdout,/OVERLAY_CLOSED real_overlay=true commits=2/);assert.match(stopped.stdout,/errors=0/);
 assert.equal(existsSync(mount),false);
 const reopened=spawnSync(client,['verify-concurrent',join(control,'store/store.sqlite')],{encoding:'utf8',timeout:15000});
 writeFileSync(join(out,'reopen.json'),JSON.stringify({exit:reopened.status,stdout:reopened.stdout,stderr:reopened.stderr},null,2));
 assert.ifError(reopened.error);assert.equal(reopened.status,0,reopened.stdout+reopened.stderr);assert.match(reopened.stdout,/REOPEN_CONCURRENT_PASS commits=2/);
 for(const [key,path]of Object.entries({host,winfsp:dll,bridge,client}))assert.equal(sha(path),identity[key]);
 writeFileSync(join(out,'interleaving.json'),JSON.stringify({startWrite,doneWrite,captured_generation:Number(cross[1]),active_generation:Number(cross[2]),capture_revision:Number(cross[3]),later_revision:Number(cross[4]),test_lane_only:true,no_product_test_hooks:true},null,2));
 console.log('PASS native concurrent published Commit: capture fixed, ordinary file callbacks finish before lane release, Install preserves later writes and creation, second Commit + independent reopen exact');
}catch(e){failure=String(e);if(held!==undefined){try{closeSync(held);}catch{}}
 if(existsSync(control)&&!existsSync(join(control,'lane-release'))){try{writeFileSync(join(control,'lane-release'),'release',{flag:'wx'});}catch{}}
 for(const p of [lane,provider])if(p&&p.child.exitCode===null&&!p.child.killed)p.child.kill();
 await Promise.all([lane?.ended,provider.ended]);throw e;
}finally{clearTimeout(timeout);writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',identity,failure,provider:provider.record,lane:lane?.record??null,workspace_qualified:false,application_visible_guarantee:false},null,2));}
