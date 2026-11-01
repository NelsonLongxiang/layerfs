// Parser regressions use copies only; synthetic inputs never become product evidence.
// node projection-test.mjs <retained-store-smoke-output>
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { facts, names, audit } from "./projection.mjs";
import { DatabaseSync } from "node:sqlite";
assert.ok(process.argv[2], "supply retained proof directory");
const dir = process.argv[2];
const original = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
const raw = names.map(n => JSON.parse(readFileSync(join(dir,n+".json"), "utf8")));
const before = JSON.stringify([original,raw]);
const row = facts(original,raw);
assert.equal(row.cases,4); assert.notEqual(row.pinned_root,row.current_root);
assert.equal(row.startup_ranges,0); assert.equal(row.binary_ranges,4);
assert.equal(row.unimplemented_explicit,1); assert.equal(row.workspace_qualified,0);
console.log("PASS retained raw proof parsing");
const cases = [
  ["mixed binary", (r,a)=>{a[0].binary_sha256="f".repeat(64);}],
  ["missing case", (r,a)=>{a.pop();}],
  ["signal", (r,a)=>{a[0].signal="SIGTERM";}],
  ["expected refusal became success", (r,a)=>{a[0].exit=0;}],
  ["invalid timestamp", (r,a)=>{a[0].started="not-a-date";}],
  ["deadline", (r,a)=>{a[0].finished=new Date(Date.parse(a[0].started)+90_001).toISOString();}],
  ["summary differs from raw", (r)=>{r.live.stdout+="invented";}],
  ["missing binary identity", (r)=>{r.binary_sha256="";}],
  ["missing marker", (r,a)=>{a[3].stdout=a[3].stdout.replace(/^STORE_COUNTS .*\n/m,"");r.live=structuredClone(a[3]);}],
  ["duplicate marker", (r,a)=>{a[3].stdout+="PROJECTION_READY no_directory_scan=true no_file_ranges=true\n";r.live=structuredClone(a[3]);}],
  ["invalid numeric field", (r,a)=>{a[3].stdout=a[3].stdout.replace("directory_entries=80","directory_entries=bogus");r.live=structuredClone(a[3]);}],
  ["wrong source root", (r,a)=>{a[3].stdout=a[3].stdout.replace(/STORE_CREATED([^\n]*)root=ObjectId\("[0-9a-f]+"\)/,'STORE_CREATED$1root=ObjectId("'+"f".repeat(64)+'")');r.live=structuredClone(a[3]);}],
];
for(const [name,mutate] of cases){const r=structuredClone(original),a=structuredClone(raw);mutate(r,a);assert.throws(()=>facts(r,a),name);console.log("PASS reject "+name);}
// A syntactically complete but failing proof remains a failing fact, not a forced PASS.
const changed=structuredClone(raw);changed[3].stdout=changed[3].stdout.replace("writeback=false","writeback=true");
const summary=structuredClone(original);summary.live=structuredClone(changed[3]);
assert.equal(facts(summary,changed).writeback,1);
assert.equal(JSON.stringify([original,raw]),before,"retained inputs unchanged");
console.log("PASS preserve negative semantic fact without rewriting it");
assert.ok(process.argv[3], "supply imported snapshot for audit tests");
const db = new DatabaseSync(process.argv[3], { readOnly:true });
const memory = new DatabaseSync(":memory:");
try {
  assert.equal(audit(db),5); console.log("PASS audit embedded raw artifacts and derived facts");
  for(const table of ["projection","projection_artifacts"]){
    memory.exec(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql);
    for(const row of db.prepare("SELECT * FROM "+table).all()){
      memory.prepare("INSERT INTO "+table+" VALUES ("+Object.keys(row).map(()=>"?").join(",")+")").run(...Object.values(row));
    }
  }
  for(const [name,sql] of [
    ["raw hash drift","UPDATE projection_artifacts SET sha256='wrong' WHERE name='store-live'"],
    ["raw body drift","UPDATE projection_artifacts SET body=body||' ' WHERE name='result'"],
    ["derived fact drift","UPDATE projection SET emitted_bytes=1"],
    ["missing artifact","DELETE FROM projection_artifacts WHERE name='store-live'"],
  ]){
    memory.exec("BEGIN");try {memory.exec(sql);assert.throws(()=>audit(memory),name);}finally {memory.exec("ROLLBACK");}
    console.log("PASS reject "+name);
  }
} finally { db.close(); memory.close(); }
