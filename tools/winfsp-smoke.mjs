// Native Overlay live proof; node tools/winfsp-smoke.mjs <host-exe> <WinFsp-dll> <Rust-dll> <reopen-checker-exe> <fresh-output>.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync,renameSync,unlinkSync,truncateSync,openSync,writeSync,readSync,closeSync,rmdirSync} from 'node:fs';
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
 const expectedNames=Array.from({length:80},(_,i)=>'e'+String(i).padStart(3,'0')+'.txt');
 assert.deepEqual(readdirSync(join(mount,'many')).sort(),expectedNames);
 const base=readFileSync(join(mount,'nested/data.bin'));assert.equal(base.length,4*1024*1024+31);
 const expectedBase=Buffer.alloc(base.length);for(let i=0;i<expectedBase.length;i++)expectedBase[i]=(i*31+Math.floor(i/251))%251;assert.deepEqual(base,expectedBase);
 mkdirSync(join(mount,'work'));mkdirSync(join(mount,'archive'));mkdirSync(join(mount,'work/src'));
 writeFileSync(join(mount,'work/src/a.txt'),'nested first',{flag:'wx'});
 assert.equal(readFileSync(join(mount,'work/src/a.txt'),'utf8'),'nested first');
 assert.throws(()=>rmdirSync(join(mount,'work/src')));
 assert.throws(()=>renameSync(join(mount,'work'),join(mount,'work/src/cycle')));
 renameSync(join(mount,'work/src'),join(mount,'archive/moved'));
 assert.equal(existsSync(join(mount,'work/src')),false);
 assert.deepEqual(readdirSync(join(mount,'archive/moved')),['a.txt']);
 renameSync(join(mount,'archive/moved/a.txt'),join(mount,'archive/moved/keep.txt'));
 writeFileSync(join(mount,'archive/moved/temp.txt'),'remove',{flag:'wx'});unlinkSync(join(mount,'archive/moved/temp.txt'));
 rmdirSync(join(mount,'work'));assert.equal(existsSync(join(mount,'work')),false);
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
 writeFileSync(join(mount,'archive/moved/keep.txt'),'nested final');
 mkdirSync(join(mount,'archive/new'));writeFileSync(join(mount,'archive/new/late.txt'),'nested late',{flag:'wx'});
 held=openSync(captured,'r+');
 writeFileSync(join(control,'commit-two'),'commit',{flag:'wx'});await phase('committed-two');
 const second=Buffer.alloc(14);readSync(held,second,0,14,0);assert.equal(second.toString(),'final! capture');
 writeFileSync(join(control,'commit-unchanged'),'commit',{flag:'wx'});await phase('committed-unchanged');
 closeSync(held);held=undefined;
 writeFileSync(join(control,'close-inspect'),'inspect',{flag:'wx'});await phase('close-idle');
 writeFileSync(join(control,'stop'),'stop',{flag:'wx'});
 const result=await ended;assert.equal(result.code,0,stdout+stderr);assert.equal(result.signal,null);
 const reopened=spawnSync(checker,['verify-commits',join(control,'store/store.sqlite')],{encoding:'utf8',timeout:20000});
 writeFileSync(join(out,'reopen.json'),JSON.stringify({exit:reopened.status,stdout:reopened.stdout,stderr:reopened.stderr},null,2));
 assert.ifError(reopened.error);assert.equal(reopened.status,0,reopened.stdout+reopened.stderr);assert.match(reopened.stdout,/REOPEN_COMMIT_PASS commits=2 via=Workspace/);
 for(const pattern of [/OVERLAY_BOUND .*source=real_Store/,/NATIVE_OVERLAY_READY/,/OVERLAY_CAPTURE_STABLE old_bytes=true later_mutation=true/,/NATIVE_COMMIT_ONE_PASS reopened_history=true via=Workspace/,/NATIVE_COMMIT_TWO_PASS earlier_snapshot_stable=true later_write_published=true/,/NATIVE_COMMIT_UPTODATE_PASS new_commit=false/,/OVERLAY_CLOSED real_overlay=true commits=2/,/NOT_RUN product_Workspace general_concurrency mapped_lifecycle full_repository/])assert.match(stdout,pattern);
 const counts=/CALLBACKS create=(\d+) open=(\d+) read=(\d+) write=(\d+) rename=(\d+) cleanup=(\d+) close=(\d+) delete=(\d+) errors=0/.exec(stdout);
 assert.ok(counts,stdout);assert.ok(counts.slice(1).every(n=>Number(n)>0));assert.match(stdout,/OVERLAY_STATE .*handles=0/);
 for(const line of stdout.split(/\r?\n/).filter(l=>l.startsWith("OVERLAY_COMMIT kind=")))assert.match(line,/scope=published /);
 assert.equal(sha(exe),binary);assert.equal(sha(dll),library);assert.equal(sha(bridge),rust);assert.equal(sha(checker),checkerHash);assert.equal(existsSync(mount),false);
 console.log('PASS native Windows -> Rust Overlay: nested mkdir/read/write/list/cross-directory rename/rmdir, two Commits, held descriptors and independent reopen');
}catch(e){failure=String(e);if(held!==undefined){try{closeSync(held);}catch{}}if(child.exitCode===null&&!child.killed)child.kill();await ended;throw e;}
finally{clearTimeout(deadline);writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',started,finished:new Date().toISOString(),exe,binary_sha256:binary,dll,dll_sha256:library,bridge,bridge_sha256:rust,checker,checker_sha256:checkerHash,mount,control,exit,failure,stdout,stderr,workspace_qualified:false,commit_writeback:failure===null},null,2));}
// A separate native process, fresh mount and Overlay owner over the SAME Store.
// No Fixture::create/Project Init is called on this route.
const second=join(out,'second');mkdirSync(second);
const mount2=join(second,'mount'),control2=join(second,'control'),store=join(control,'store/store.sqlite');
const began=new Date().toISOString();let out2='',err2='',failure2=null,exit2=null;
const secondChild=spawn(exe,[dll,mount2,control2,bridge,store],{stdio:['ignore','pipe','pipe']});
secondChild.stdout.on('data',d=>{out2+=d;});secondChild.stderr.on('data',d=>{err2+=d;});
const ended2=new Promise(resolve=>{secondChild.once('error',e=>{failure2=e.message;resolve({error:e.message});});secondChild.once('exit',(code,signal)=>{exit2={code,signal};resolve(exit2);});});
const deadline2=setTimeout(()=>{failure2='second native provider exceeded 40 seconds';secondChild.kill();},40000);
async function phase2(name){const until=Date.now()+15000;while(!existsSync(join(control2,name))){assert.equal(exit2,null,out2+err2);if(failure2)throw new Error(failure2);assert.ok(Date.now()<until,'second phase '+name);await new Promise(r=>setTimeout(r,10));}}
try{
 await phase2('ready');
 assert.equal(readFileSync(join(mount2,'capture.txt'),'utf8'),'final! capture');
 assert.equal(readFileSync(join(mount2,'archive/moved/keep.txt'),'utf8'),'nested final');
 assert.equal(readFileSync(join(mount2,'archive/new/late.txt'),'utf8'),'nested late');
 assert.equal(readFileSync(join(mount2,'late.txt'),'utf8'),'after commit');
 assert.equal(readFileSync(join(mount2,'probe.bin'),'utf8'),'new inode');
 assert.deepEqual(readdirSync(join(mount2,'archive')).sort(),['moved','new']);
 assert.deepEqual(readdirSync(join(mount2,'many')).sort(),Array.from({length:80},(_,i)=>'e'+String(i).padStart(3,'0')+'.txt'));assert.equal(existsSync(join(mount2,'work')),false);
 writeFileSync(join(control2,'commit-unchanged'),'commit',{flag:'wx'});await phase2('committed-unchanged');
 writeFileSync(join(control2,'close-inspect'),'inspect',{flag:'wx'});await phase2('close-idle');
 writeFileSync(join(control2,'stop'),'stop',{flag:'wx'});const result=await ended2;
 assert.equal(result.code,0,out2+err2);assert.equal(result.signal,null);
 assert.match(out2,/STORE_REBOUND existing=true init=false/);assert.match(out2,/NATIVE_REBOUND_READY existing_store=true init=false/);
 assert.doesNotMatch(out2,/STORE_CREATED|OVERLAY_COMMIT kind=Committed/);
 assert.match(out2,/OVERLAY_COMMIT kind=UpToDate scope=published /);assert.match(out2,/OVERLAY_CLOSED real_overlay=true commits=0/);
 assert.equal(existsSync(mount2),false);assert.equal(sha(exe),binary);assert.equal(sha(bridge),rust);assert.equal(sha(dll),library);assert.equal(sha(checker),checkerHash);
 const reopened=spawnSync(checker,['verify-commits',store],{encoding:'utf8',timeout:20000});
 writeFileSync(join(second,'reopen-after.json'),JSON.stringify({exit:reopened.status,stdout:reopened.stdout,stderr:reopened.stderr},null,2));
 assert.ifError(reopened.error);assert.equal(reopened.status,0,reopened.stdout+reopened.stderr);
 console.log('PASS second native mount: same committed Store, new Overlay owner, nested tree exact, Init not called, UpToDate adds no Commit');
}catch(e){failure2=String(e);if(secondChild.exitCode===null&&!secondChild.killed)secondChild.kill();await ended2;throw e;}
finally{clearTimeout(deadline2);writeFileSync(join(second,'result.json'),JSON.stringify({status:failure2?'FAIL':'PASS',started:began,finished:new Date().toISOString(),exe,binary_sha256:binary,bridge,bridge_sha256:rust,store,mount:mount2,control:control2,exit:exit2,failure:failure2,stdout:out2,stderr:err2,workspace_qualified:false},null,2));}
