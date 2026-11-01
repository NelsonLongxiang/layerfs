// Native Overlay live proof; node tools/winfsp-smoke.mjs <host-exe> <WinFsp-dll> <Rust-dll> <reopen-checker-exe> <fresh-output>.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync,renameSync,unlinkSync,truncateSync,openSync,writeSync,readSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
assert.equal(process.platform,'win32');assert.ok(process.argv[2]&&process.argv[3]&&process.argv[4]&&process.argv[5]&&process.argv[6]);
const exe=resolve(process.argv[2]),dll=resolve(process.argv[3]),bridge=resolve(process.argv[4]),checker=resolve(process.argv[5]),out=resolve(process.argv[6]);
assert.ok(!existsSync(out),'never overwrite proof');mkdirSync(out);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const binary=sha(exe),library=sha(dll),rust=sha(bridge),checkerHash=sha(checker),mount=join(out,'mount'),control=join(out,'control');
const occupied=join(out,'occupied');mkdirSync(occupied);writeFileSync(join(occupied,'sentinel'),'keep');
for(const [name,path,ctrl] of [['occupied',occupied,join(out,'unused-control')],['relative','relative-mount',join(out,'relative-control')]]){
 const r=spawnSync(exe,[dll,path,ctrl,bridge],{encoding:'utf8',timeout:5000});
 writeFileSync(join(out,name+'.json'),JSON.stringify({exit:r.status,stdout:r.stdout,stderr:r.stderr},null,2));
 assert.ifError(r.error);assert.equal(r.status,1);assert.equal(existsSync(ctrl),false);
}
assert.equal(readFileSync(join(occupied,'sentinel'),'utf8'),'keep');
const started=new Date().toISOString();let stdout='',stderr='',failure=null,exit=null,held;
const child=spawn(exe,[dll,mount,control,bridge],{stdio:['ignore','pipe','pipe']});
child.stdout.on('data',d=>{stdout+=d;});child.stderr.on('data',d=>{stderr+=d;});
const ended=new Promise(resolve=>{child.once('error',e=>{failure=e.message;resolve({error:e.message});});child.once('exit',(code,signal)=>{exit={code,signal};resolve(exit);});});
const deadline=setTimeout(()=>{failure='native provider exceeded 60 seconds';child.kill();},60000);
async function phase(name){const until=Date.now()+15000;while(!existsSync(join(control,name))){assert.equal(exit,null,stdout+stderr);if(failure)throw new Error(failure);assert.ok(Date.now()<until,'phase deadline '+name);await new Promise(r=>setTimeout(r,10));}}
try{
 await phase('ready');
 assert.equal(readFileSync(join(mount,'alpha.txt'),'utf8'),'old immutable Store version\n');
 const input=Buffer.alloc(300000);for(let i=0;i<input.length;i++)input[i]=(i*31+i/97)%251;
 const path=join(mount,'probe.bin');writeFileSync(path,input,{flag:'wx'});
 assert.deepEqual(readFileSync(path),input);assert.ok(readdirSync(mount).includes('probe.bin'));
 assert.throws(()=>writeFileSync(path,'duplicate',{flag:'wx'}));assert.deepEqual(readFileSync(path),input);
 truncateSync(path,31);assert.deepEqual(readFileSync(path),input.subarray(0,31));
 renameSync(path,join(mount,'renamed.bin'));assert.deepEqual(readFileSync(join(mount,'renamed.bin')),input.subarray(0,31));
 unlinkSync(join(mount,'renamed.bin'));assert.ok(!existsSync(join(mount,'renamed.bin')));
 writeFileSync(path,'new inode',{flag:'wx'});assert.equal(readFileSync(path,'utf8'),'new inode');
 const captured=join(mount,'capture.txt');writeFileSync(captured,'before capture',{flag:'wx'});
 // The first close publishes cached writes. Keep a new descriptor alive over capture;
 // no claim that unflushed kernel bytes belong to the locally published frontier.
 held=openSync(captured,'r+');writeFileSync(join(control,'capture'),'capture',{flag:'wx'});await phase('captured');
 writeSync(held,Buffer.from('after!'),0,6,0);const live=Buffer.alloc(14);readSync(held,live,0,14,0);assert.equal(live.toString(),'after! capture');
 closeSync(held);held=undefined;assert.equal(readFileSync(captured,'utf8'),'after! capture');
 writeFileSync(join(control,'check-capture'),'check',{flag:'wx'});await phase('capture-checked');
 held=openSync(captured,'r+');
 writeFileSync(join(control,'commit-one'),'commit',{flag:'wx'});await phase('committed-one');
 const first=Buffer.alloc(14);readSync(held,first,0,14,0);assert.equal(first.toString(),'after! capture');
 writeSync(held,Buffer.from('final!'),0,6,0);closeSync(held);held=undefined;
 assert.equal(readFileSync(captured,'utf8'),'final! capture');
 writeFileSync(join(mount,'late.txt'),'after commit',{flag:'wx'});
 held=openSync(captured,'r+');
 writeFileSync(join(control,'commit-two'),'commit',{flag:'wx'});await phase('committed-two');
 const second=Buffer.alloc(14);readSync(held,second,0,14,0);assert.equal(second.toString(),'final! capture');
 writeFileSync(join(control,'commit-unchanged'),'commit',{flag:'wx'});await phase('committed-unchanged');
 closeSync(held);held=undefined;
 writeFileSync(join(control,'stop'),'stop',{flag:'wx'});
 const result=await ended;assert.equal(result.code,0,stdout+stderr);assert.equal(result.signal,null);
 const reopened=spawnSync(checker,['verify-commits',join(control,'store/store.sqlite')],{encoding:'utf8',timeout:20000});
 writeFileSync(join(out,'reopen.json'),JSON.stringify({exit:reopened.status,stdout:reopened.stdout,stderr:reopened.stderr},null,2));
 assert.ifError(reopened.error);assert.equal(reopened.status,0,reopened.stdout+reopened.stderr);assert.match(reopened.stdout,/REOPEN_COMMIT_PASS commits=2 via=Workspace/);
 for(const pattern of [/OVERLAY_BOUND .*source=real_Store/,/NATIVE_OVERLAY_READY/,/OVERLAY_CAPTURE_STABLE old_bytes=true later_mutation=true/,/NATIVE_COMMIT_ONE_PASS reopened_history=true via=Workspace/,/NATIVE_COMMIT_TWO_PASS earlier_snapshot_stable=true later_write_published=true/,/NATIVE_COMMIT_UPTODATE_PASS new_commit=false/,/OVERLAY_CLOSED real_overlay=true commits=2/,/NOT_RUN product_Workspace concurrent_commit mapped_lifecycle full_repository/])assert.match(stdout,pattern);
 const counts=/CALLBACKS create=(\d+) open=(\d+) read=(\d+) write=(\d+) rename=(\d+) cleanup=(\d+) close=(\d+) delete=(\d+) errors=0/.exec(stdout);
 assert.ok(counts,stdout);assert.ok(counts.slice(1).every(n=>Number(n)>0));assert.match(stdout,/OVERLAY_STATE .*handles=0/);
 assert.equal(sha(exe),binary);assert.equal(sha(dll),library);assert.equal(sha(bridge),rust);assert.equal(sha(checker),checkerHash);assert.equal(existsSync(mount),false);
 console.log('PASS native Windows -> Rust Overlay: real Store read, 300KB writes, truncate/rename/delete/recreate, captured old bytes, two actual Commits, held descriptors, independent read-only reopen and UpToDate');
}catch(e){failure=String(e);if(held!==undefined){try{closeSync(held);}catch{}}if(child.exitCode===null&&!child.killed)child.kill();await ended;throw e;}
finally{clearTimeout(deadline);writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',started,finished:new Date().toISOString(),exe,binary_sha256:binary,dll,dll_sha256:library,bridge,bridge_sha256:rust,checker,checker_sha256:checkerHash,mount,control,exit,failure,stdout,stderr,workspace_qualified:false,commit_writeback:failure===null},null,2));}
