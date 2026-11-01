// Run namespace counterexample on a fresh root; node namespace-smoke.mjs <exe> <new-output>.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
assert.ok(process.argv[2]&&process.argv[3]);
const exe=resolve(process.argv[2]),out=resolve(process.argv[3]);assert.ok(!existsSync(out));mkdirSync(out);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const binary=hash(exe);
const records=[];
function run(name,args,exit){
 const env={...process.env};delete env.LAYERFS_PROJFS_PROBE_CHILD_ROOT;
 const started=new Date().toISOString();const r=spawnSync(exe,args,{env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
 const row={name,args,exe,binary_sha256:binary,started,finished:new Date().toISOString(),exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr};
 records.push(row);writeFileSync(join(out,name+'.json'),JSON.stringify(row,null,2));assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,exit,r.stdout+r.stderr);return row;
}
run('direct-child-refuses',['namespace-child',out],1);
run('relative-refuses',['namespace-live','relative-namespace-proof'],1);
const occupied=join(out,'occupied');mkdirSync(occupied);const sentinel=join(occupied,'keep');writeFileSync(sentinel,'preserved');const before=hash(sentinel);
assert.match(run('existing-refuses',['namespace-live',occupied],1).stderr,/refusing existing root/);assert.equal(hash(sentinel),before);
const live=run('namespace-live',['namespace-live',join(out,'case')],0);
for(const pattern of [
 /DIRECTORY_GUARD_HELD share_read_only=true file_guard_held=true/,
 /GUARDED_FILE_WRITE_REFUSED win32=32/,
 /ROOT_RENAME_REFUSED win32=32/,
 /NAMESPACE_CHILD_PASS mkdir=true create=true write=true nested_rename=true delete=true root_rename_refused=true/,
 /NAMESPACE_BOUNDARY_PASS guarded_bytes_stable=true descendants_mutated=true directory_guard_not_snapshot=true panics=0 overflow=0/,
 /NOT_RUN atomic_namespace_capture generation_writeback workspace_commit/,
])assert.match(live.stdout,pattern);
assert.equal(hash(exe),binary);
writeFileSync(join(out,'result.json'),JSON.stringify({status:'PASS',cases:records.length,binary_sha256:binary,namespace_capture:false,workspace_qualified:false,live},null,2));
console.log('PASS namespace boundary: 4 CLI cases; held directory/file guard does not freeze descendant namespace');
