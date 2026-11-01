// Bounded native counterexample; retained roots/receipts, no product qualification.
// node capture-smoke.mjs <probe-exe> <fresh-output-directory>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
assert.ok(process.argv[2] && process.argv[3], "name executable and fresh output directory");
const exe = resolve(process.argv[2]), out = resolve(process.argv[3]);
assert.ok(!existsSync(out), "never overwrite a proof"); mkdirSync(out);
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const binary = sha(exe), records=[];
function run(name,args,exit){
  const env={...process.env}; delete env.LAYERFS_PROJFS_PROBE_CHILD_ROOT;
  const started=new Date().toISOString();
  const r=spawnSync(exe,args,{env,encoding:"utf8",timeout:30_000,maxBuffer:2*1024*1024});
  const record={name,exe,binary_sha256:binary,args,started,finished:new Date().toISOString(),
    exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr};
  writeFileSync(join(out,name+".json"),JSON.stringify(record,null,2));records.push(record);
  assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,exit,r.stdout+r.stderr);return record;
}
run("direct-child-refuses",["capture-child",out],1);
run("relative-refuses",["capture-live","relative-capture-probe"],1);
const occupied=join(out,"occupied");mkdirSync(occupied);
const sentinel=join(occupied,"keep.txt");writeFileSync(sentinel,"untouched\n");const original=sha(sentinel);
assert.match(run("existing-refuses",["capture-live",occupied],1).stderr,/refusing existing root/);
assert.equal(sha(sentinel),original);assert.equal(existsSync(join(occupied,"control")),false);
const live=run("capture-live",["capture-live",join(out,"case")],0);
for(const pattern of [
  /SHARING_REFUSED live-writer-blocks-capture-open win32=32/,
  /SHARING_REFUSED capture-open-blocks-new-writer win32=32/,
  /SHARING_REFUSED child-writer-blocked-by-capture-open win32=32/,
  /CLOSED_HANDLE_CONTROL read_byte=65 deny_write_open=true new_writer_refused=true external_writer_refused=true replay_byte=65/,
  /SHARING_REFUSED map-only-blocks-capture-open win32=32/,
  /MAP_ONLY_SHARING deny_write_open=false win32=32/,
  /LOCK_COUNTEREXAMPLE lock_held=true mapped_before=66 mapped_after=67/,
  /STOP_RETURNED child_alive=true mapping_alive=true lock_held=true/,
  /STOP_COUNTEREXAMPLE mapped_before=67 mapped_after=68 callbacks_after_stop=0 lock_held=true/,
  /CAPTURE_CHILD_PASS ordinary_write=true file_handle_closed=true section_handle_closed=true mapped_after_stop=true/,
  /FINAL_OBSERVATION read_file=68 expected_mapped_byte=68 durability_claim=false/,
  /CAPTURE_BOUNDARY_PASS byte_lock_not_snapshot=true provider_stop_not_mapping_fence=true panics=0 overflow=0/,
  /NOT_RUN stable_overlay_capture commit_writeback product_workspace complete_mapping_detection/,
])assert.match(live.stdout,pattern);
assert.equal(sha(exe),binary);
writeFileSync(join(out,"result.json"),JSON.stringify({status:"PASS",cases:records.length,binary_sha256:binary,
  scope:"counterexample, not stable input/Workspace qualification",stable_capture:false,workspace_qualified:false,live},null,2));
console.log("PASS capture boundary: 4 CLI cases; byte lock and ProjFS stop do not freeze an external writable mapping; stable capture NOT_RUN");
