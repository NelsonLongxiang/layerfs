// Native callback live proof; node tools/winfsp-smoke.mjs <exe> <installed-dll> <fresh-output>.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync,renameSync,unlinkSync,truncateSync} from 'node:fs';
import {join,resolve} from 'node:path';
assert.equal(process.platform,'win32');assert.ok(process.argv[2]&&process.argv[3]&&process.argv[4]);
const exe=resolve(process.argv[2]),dll=resolve(process.argv[3]),out=resolve(process.argv[4]);
assert.ok(!existsSync(out),'never overwrite proof');mkdirSync(out);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const binary=sha(exe),library=sha(dll);const mount=join(out,'mount'),control=join(out,'control');
const occupied=join(out,'occupied');mkdirSync(occupied);writeFileSync(join(occupied,'sentinel'),'keep');
const refusal=spawnSync(exe,[dll,occupied,join(out,'unused-control')],{encoding:'utf8',timeout:5000});
writeFileSync(join(out,'refusal.json'),JSON.stringify({exit:refusal.status,stdout:refusal.stdout,stderr:refusal.stderr},null,2));
assert.ifError(refusal.error);assert.equal(refusal.status,1);assert.match(refusal.stderr,/existing mount/);assert.equal(readFileSync(join(occupied,'sentinel'),'utf8'),'keep');assert.equal(existsSync(join(out,'unused-control')),false);
const relative=spawnSync(exe,[dll,'relative-mount',join(out,'relative-control')],{encoding:'utf8',timeout:5000});
writeFileSync(join(out,'relative.json'),JSON.stringify({exit:relative.status,stdout:relative.stdout,stderr:relative.stderr},null,2));
assert.ifError(relative.error);assert.equal(relative.status,1);assert.equal(existsSync(join(out,'relative-control')),false);
const started=new Date().toISOString();let stdout='',stderr='',failure=null,exit=null;
const child=spawn(exe,[dll,mount,control],{stdio:['ignore','pipe','pipe']});
child.stdout.on('data',d=>{stdout+=d;});child.stderr.on('data',d=>{stderr+=d;});
const ended=new Promise(resolve=>{child.once('error',e=>{failure=e.message;resolve({error:e.message});});child.once('exit',(code,signal)=>{exit={code,signal};resolve(exit);});});
const deadline=setTimeout(()=>{failure='native provider exceeded 40 seconds';child.kill();},40000);
try {
 const until=Date.now()+10000;
 while(!existsSync(join(control,'ready'))){assert.equal(exit,null,stdout+stderr);if(failure)throw new Error(failure);assert.ok(Date.now()<until,'ready deadline');await new Promise(r=>setTimeout(r,10));}
 const input=Buffer.from('ordinary Windows process -> native callback\n'.repeat(100));
 const path=join(mount,'probe.bin');writeFileSync(path,input,{flag:'wx'});
 assert.deepEqual(readFileSync(path),input);assert.ok(readdirSync(mount).includes('probe.bin'));
 assert.throws(()=>truncateSync(path,65537));assert.deepEqual(readFileSync(path),input);
 truncateSync(path,31);assert.deepEqual(readFileSync(path),input.subarray(0,31));
 renameSync(path,join(mount,'renamed.bin'));assert.deepEqual(readFileSync(join(mount,'renamed.bin')),input.subarray(0,31));
 unlinkSync(join(mount,'renamed.bin'));assert.ok(!existsSync(join(mount,'renamed.bin')));
 assert.throws(()=>writeFileSync(path,'no node reuse',{flag:'wx'}));
 writeFileSync(join(control,'stop'),'stop',{flag:'wx'});
 const result=await ended;assert.equal(result.code,0,stdout+stderr);assert.equal(result.signal,null);
 assert.match(stdout,/NATIVE_DISPATCH_READY/);
 const counts=/CALLBACKS create=(\d+) open=(\d+) read=(\d+) write=(\d+) rename=(\d+) cleanup=(\d+) close=(\d+) delete=(\d+)/.exec(stdout);
 assert.ok(counts,stdout);assert.ok(counts.slice(1).every(n=>Number(n)>0));
 assert.match(stdout,/NOT_RUN LayerFS_Overlay capture Save History mapped_lifecycle full_repository/);
 assert.equal(sha(exe),binary);assert.equal(sha(dll),library);
 assert.equal(existsSync(mount),false,'owned mount removed after dispatcher stop');
 console.log('PASS native WinFsp request callbacks: create/read/write/truncate/rename/delete + existing mount refusal; NOT_RUN LayerFS capture/Commit');
} catch(e){failure=String(e);if(child.exitCode===null&&!child.killed)child.kill();await ended;throw e;}
finally{clearTimeout(deadline);writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',started,finished:new Date().toISOString(),exe,binary_sha256:binary,dll,dll_sha256:library,mount,control,exit,failure,stdout,stderr,workspace_qualified:false},null,2));}
