// Import closed native diagnostic receipts, never invoke a mount/product operation.
// node native.mjs <base.sqlite> <proof-directory> <source-commit> <fresh-output>; --audit
// <snapshot>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve, win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {audit as auditProjection} from './projection.mjs';
import {analyze as cacheFacts} from '../../../winfsp-cache-test.mjs';
import {analyze as closeFacts} from '../../../winfsp-close-test.mjs';
export const inputs = {
  native: 'native-regression/result.json',
  reopen: 'native-regression/reopen.json',
  remount: 'native-regression/second/result.json',
  remount_reopen: 'native-regression/second/reopen-after.json',
  concurrent: 'concurrent-regression/result.json',
  concurrent_reopen: 'concurrent-regression/reopen.json',
  interleaving: 'concurrent-regression/interleaving.json',
  cache: 'cache-regression/result.json',
  cache_reopen: 'cache-regression/reopen.json',
  observations: 'cache-regression/observations.json',
  close: 'live-final/result.json',
  source_seal: 'source-seal.json',
  host_build: 'host-ordered.json',
  rust_build: 'build-final.json',
  rust_tests: 'rust-final.json',
};
export const hash = b => createHash('sha256').update(b).digest('hex');
const sha = (s, n = 64) => assert.match(s, new RegExp('^[0-9a-f]{' + n + '}$'));
const lines = s => s.split(/\r?\n/).filter(Boolean);
function one(s, pattern) {
  const matches = lines(s).map(l => pattern.exec(l)).filter(Boolean);
  assert.equal(matches.length, 1, 'missing/duplicate ' + pattern);
  return matches[0];
}
function timed(r) {
  assert.equal(r.exit.code, 0);
  assert.equal(r.exit.signal, null);
  if ('error' in r) assert.equal(r.error, null);
  const a = Date.parse(r.started), b = Date.parse(r.finished);
  assert.ok(
      Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 120000,
      'valid bounded process time');
  assert.equal(typeof r.stdout, 'string');
  assert.equal(typeof r.stderr, 'string');
}
function command(r) {
  assert.equal(r.kind, 'foreground');
  assert.equal(r.exitCode, 0);
  assert.equal(r.signal, null);
  assert.equal(r.timedOut, false);
  assert.equal(r.aborted, false);
  assert.equal(r.stdout.truncated, false);
  assert.equal(r.stderr.truncated, false);
  return r.stdout.text;
}
function processReceipt(r) {
  assert.equal(r.status, 'PASS');
  assert.equal(r.failure, null);
  assert.equal(r.workspace_qualified, false);
  if (r.provider) {
    timed(r.provider);
    timed(r.application ?? r.lane);
  } else
    timed(r);
}
function callbacks(s) {
  const m = one(
      s,
      /^CALLBACKS create=(\d+) open=(\d+) read=(\d+) write=(\d+) rename=(\d+) cleanup=(\d+) close=(\d+) delete=(\d+) errors=(\d+)$/);
  const n = m.slice(1).map(Number);
  assert.equal(n[8], 0);
  assert.equal(n[5], n[6]);
  return n;
}
function closeOrder(s) {
  const markers = [
    'NORMAL_CLOSE_IDLE ', 'NORMAL_CLOSE_PREPARED ', 'NORMAL_CLOSE_STOP_BEGIN ',
    'NORMAL_CLOSE_DISPATCHER_DRAINED', 'OVERLAY_CLOSED ', 'NORMAL_CLOSE_DONE '
  ];
  let previous = -1;
  for (const p of markers) {
    const found = lines(s).filter(l => l.startsWith(p));
    assert.equal(found.length, 1, p);
    const at = s.indexOf(found[0]);
    assert.ok(at > previous, 'close order ' + p);
    previous = at;
  }
  assert.match(s, /NORMAL_CLOSE_DONE detach=true overlay_closed=true/);
}
function commits(s) {
  const all = lines(s).filter(l => l.startsWith('OVERLAY_COMMIT kind='));
  assert.ok(all.length);
  for (const l of all)
    assert.match(l, /^OVERLAY_COMMIT kind=(Committed|UpToDate) scope=published /);
  const out = all.filter(l => l.includes('kind=Committed ')).map(l => {
    const m =
        /id=CommitId\(([0-9a-f]{66})\) root=ObjectId\("([0-9a-f]{64})"\) parent=(None|Some\(CommitId\(([0-9a-f]{66})\)\)) via=Workspace saved_bytes=(\d+) open_handles=(\d+)$/
            .exec(l);
    assert.ok(m, l);
    return {id: m[1], root: m[2], parent: m[4] ?? null, handles: Number(m[6])};
  });
  const ids = new Set();
  for (const [i, r] of out.entries()) {
    assert.equal(r.parent, i ? out[i - 1].id : null);
    assert.ok(!ids.has(r.id));
    ids.add(r.id);
  }
  if (out.length)
    for (const l of all.filter(l => l.includes('kind=UpToDate '))) {
      const m =
          /head=Some\(CommitId\(([0-9a-f]{66})\)\) root=ObjectId\("([0-9a-f]{64})"\) new_commit=false$/
              .exec(l);
      assert.ok(m);
      assert.ok(out.some(r => r.id === m[1] && r.root === m[2]));
    }
  return out;
}
function reopened(r, ids, concurrent = false) {
  assert.equal(r.exit, 0);
  assert.equal(r.stderr, '');
  const prefix = concurrent ? 'REOPEN_CONCURRENT' : 'REOPEN';
  one(r.stdout,
      concurrent ?
          /^REOPEN_CONCURRENT_PASS commits=2 old_commit_fixed=true later_creation=true head_exact=true readonly=true$/ :
          /^REOPEN_COMMIT_PASS commits=2 via=Workspace ancestry=true old_snapshot_stable=true later_creation=true head_exact=true readonly=true$/);
  const m =
      one(r.stdout,
          new RegExp(
              '^' + prefix +
              '_IDS first=CommitId\\(([0-9a-f]{66})\\) second=CommitId\\(([0-9a-f]{66})\\)$'));
  assert.deepEqual(m.slice(1), ids.map(r => r.id));
}
export function facts(a) {
  assert.deepEqual(Object.keys(a).sort(), [...Object.keys(inputs), 'manifest'].sort());
  const m = a.manifest, n = a.native, r = a.remount, c = a.concurrent, k = a.cache, z = a.close;
  for (const v of [n, r, c, k, z]) processReceipt(v);
  const identity = {
    host: n.binary_sha256,
    winfsp: n.dll_sha256,
    bridge: n.bridge_sha256,
    client: n.checker_sha256
  };
  for (const h of Object.values(identity)) sha(h);
  for (const v of [c, k, z]) assert.deepEqual(v.identity, identity);
  assert.equal(r.binary_sha256, identity.host);
  assert.equal(r.bridge_sha256, identity.bridge);
  assert.deepEqual(m.observed_binary_sha256, identity);
  assert.deepEqual(
      Object.keys(m.baseline_tables).sort(),
      ['identity', 'preflight', 'projection', 'projection_artifacts', 'receipts']);
  for (const h of Object.values(m.baseline_tables)) sha(h);
  sha(m.source_commit, 40);
  sha(m.source_tree, 40);
  sha(m.probe_tree, 40);
  sha(m.cpp_blob, 40);
  sha(m.baseline_sha256);
  assert.ok(Number.isFinite(Date.parse(m.imported_at)));
  assert.equal(m.evidence_kind, 'retained-native-diagnostic');
  assert.equal(m.source_attribution, 'declared source plus byte checks; not build attestation');
  assert.deepEqual(Object.keys(m.harness_sha256).sort(), [
    'tools/winfsp-cache-test.mjs', 'tools/winfsp-close-test.mjs',
    'tools/winfsp-concurrent-test.mjs', 'tools/winfsp-smoke.mjs'
  ]);
  for (const h of Object.values(m.harness_sha256)) sha(h);
  const seal = lines(command(a.source_seal));
  assert.deepEqual(seal, [m.tested_tree, m.probe_tree, m.cpp_blob]);
  sha(m.tested_tree, 40);
  const hostText = command(a.host_build), build = JSON.parse(hostText.slice(hostText.indexOf('{')));
  assert.equal(build.binarySha256.toLowerCase(), identity.host);
  assert.equal(build.sourceSha256.toLowerCase(), m.cpp_sha256);
  sha(m.cpp_sha256);
  assert.equal(a.rust_build.job.status, 'completed');
  assert.equal(a.rust_build.job.detail, 'exit code: 0');
  assert.match(a.rust_build.job.label, /--offline --locked/);
  assert.match(a.rust_build.job.label, /--no-run/);
  assert.match(a.rust_build.job.label, /clippy.*-D warnings/);
  const unit = command(a.rust_tests);
  assert.deepEqual(
      [...unit.matchAll(/test result: ok[.] (\d+) passed; 0 failed/g)].map(v => Number(v[1])),
      [8, 5, 2]);
  assert.match(
      unit,
      /NORMAL_CLOSE_UNIT_PASS refusals_unchanged=true admission_fenced=true history_kept=true/);
  assert.match(unit, /COMMIT_SCOPE_UNIT_PASS refusal_before_effect=true published_route_kept=true/);
  for (const s of [n.stdout, r.stdout, c.provider.stdout, k.provider.stdout, z.provider.stdout]) {
    callbacks(s);
    closeOrder(s);
    assert.match(s, /OVERLAY_BOUND .*profile=Disposable overlay=MEMORY_OFF_EXCLUSIVE/);
    one(s, /^NOT_RUN product_Workspace general_concurrency mapped_lifecycle full_repository$/);
  }
  const ns = n.stdout, nc = commits(ns), counts = callbacks(ns);
  assert.equal(n.commit_writeback, true);
  assert.equal(nc.length, 2);
  assert.ok(nc.every(x => x.handles > 0));
  assert.ok([0, 1, 2, 3, 4, 7].every(i => counts[i] > 0));
  one(ns, /^OVERLAY_CAPTURE_STABLE old_bytes=true later_mutation=true$/);
  one(ns, /^NATIVE_COMMIT_ONE_PASS reopened_history=true via=Workspace$/);
  one(ns, /^NATIVE_COMMIT_TWO_PASS earlier_snapshot_stable=true later_write_published=true$/);
  reopened(a.reopen, nc);
  assert.equal(
      win32.normalize(r.store), win32.join(win32.normalize(n.control), 'store', 'store.sqlite'));
  assert.ok(Date.parse(r.started) >= Date.parse(n.finished));
  one(r.stdout, /^STORE_REBOUND existing=true init=false$/);
  assert.doesNotMatch(r.stdout, /STORE_CREATED/);
  assert.equal(commits(r.stdout).length, 0);
  one(r.stdout, /^NATIVE_REBOUND_READY existing_store=true init=false$/);
  assert.ok(r.stdout.includes(
      'head=Some(CommitId(' + nc[1].id + ')) root=ObjectId("' + nc[1].root +
      '") new_commit=false'));
  reopened(a.remount_reopen, nc);
  assert.deepEqual(a.reopen, a.remount_reopen);
  const cache = cacheFacts(k.provider.stdout, k.application.stdout);
  assert.deepEqual(a.observations.identity, identity);
  for (const [key, value] of Object.entries(cache)) assert.deepEqual(a.observations[key], value);
  assert.equal(a.observations.workspace_qualified, false);
  const kc = commits(k.provider.stdout), kh = [
    ...a.cache_reopen.stdout.matchAll(
        /CACHE_HISTORY id=CommitId\(([0-9a-f]{66})\) byte=(\d+) parent=(None|Some\(CommitId\(([0-9a-f]{66})\)\)) via=Workspace/g)
  ];
  assert.equal(a.cache_reopen.exit, 0);
  assert.equal(a.cache_reopen.stderr, '');
  assert.deepEqual(kh.map(v => v[1]), kc.map(x => x.id));
  assert.deepEqual(kh.map(v => v[4] ?? null), kc.map(x => x.parent));
  assert.deepEqual(
      kh.map(v => Number(v[2])),
      cache.phases.filter(p => p.commit_changed === 1).map(p => p.committed));
  one(a.cache_reopen.stdout,
      new RegExp(
          '^REOPEN_CACHE_PASS commits=' + kc.length +
          ' final_byte=68 tail_exact=true head_exact=true readonly=true$'));
  const cs = c.provider.stdout, cc = commits(cs);
  assert.equal(cc.length, 2);
  reopened(a.concurrent_reopen, cc, true);
  const
      cap =
          one(cs,
              /^CONCURRENT_CAPTURE generation=(\d+) revision=(\d+) active=(\d+) duplicate_commit=Busy capture=Busy close=Busy$/)
              .slice(1)
              .map(Number),
      cross =
          one(cs,
              /^CONCURRENT_WRITES_CONFIRMED captured=(\d+) active=(\d+) capture_revision=(\d+) later_revision=(\d+) commit_still_running=true$/)
              .slice(1)
              .map(Number);
  assert.equal(cross[0], cap[0]);
  assert.equal(cross[1], cap[2]);
  assert.equal(cross[2], cap[1]);
  assert.ok(cross[1] > cross[0] && cross[3] > cross[2]);
  assert.ok(
      cs.indexOf('CONCURRENT_WRITES_CONFIRMED') < cs.indexOf('OVERLAY_COMMIT kind=Committed'));
  one(cs, /^CONCURRENT_INSTALL_PASS old_commit_fixed=true later_live_preserved=true$/);
  one(c.lane.stdout, /^LANE_HELD existing_public_port=true history_publications=0$/);
  one(c.lane.stdout, /^LANE_RELEASED requested=true$/);
  const i = a.interleaving;
  assert.deepEqual(
      [i.captured_generation, i.active_generation, i.capture_revision, i.later_revision], cross);
  assert.equal(i.test_lane_only, true);
  assert.equal(i.no_product_test_hooks, true);
  assert.ok(
      Date.parse(c.lane.started) <= Date.parse(i.startWrite) &&
      Date.parse(i.startWrite) <= Date.parse(i.doneWrite) &&
      Date.parse(i.doneWrite) <= Date.parse(c.lane.finished));
  assert.equal(c.application_visible_guarantee, false);
  const close = closeFacts(z.provider.stdout, z.application.stdout);
  assert.equal(close.length, 4);
  assert.equal(z.general_section_inventory, false);
  const started =
            [
              n.started, r.started, c.provider.started, k.provider.started, z.provider.started
            ].sort()[0],
        ended = [
          n.finished, r.finished, c.provider.finished, k.provider.finished, z.provider.finished
        ].sort().at(-1);
  assert.ok(Date.parse(m.imported_at) >= Date.parse(ended));
  return {
    id: 1,
    source_commit: m.source_commit,
    source_tree: m.source_tree,
    probe_tree: m.probe_tree,
    cpp_blob: m.cpp_blob,
    host_sha256: identity.host,
    winfsp_sha256: identity.winfsp,
    bridge_sha256: identity.bridge,
    client_sha256: identity.client,
    imported_at: m.imported_at,
    started,
    ended,
    identity_checked: 1,
    native_runs: 5,
    rust_passes: 15,
    mutation_commits: nc.length,
    mutation_reopen_exact: 1,
    open_across_commit: 1,
    remount_same_store: 1,
    remount_new_commits: 0,
    remount_head_exact: 1,
    scope_refusals: 8,
    cache_phases: cache.phases.length,
    published_consistent: 1,
    mapping_gap: Number(cache.mappingGap),
    application_visible_guarantee: 0,
    concurrent_capture_generation: cross[0],
    concurrent_active_generation: cross[1],
    capture_revision: cross[2],
    later_revision: cross[3],
    install_kept_later: 1,
    close_refusals: 5,
    close_ordered: 1,
    refusal_io_usable: 1,
    workspace_qualified: 0,
    general_concurrency_qualified: 0,
    general_section_inventory: 0,
    evidence_kind: m.evidence_kind,
    artifact_count: Object.keys(a).length
  };
}
function artifactsFrom(db) {
  const rows = db.prepare('SELECT * FROM native_artifacts ORDER BY name').all();
  assert.deepEqual(rows.map(r => r.name), [...Object.keys(inputs), 'manifest'].sort());
  for (const r of rows) assert.equal(hash(r.body), r.sha256, 'artifact bytes ' + r.name);
  return Object.fromEntries(rows.map(r => [r.name, JSON.parse(r.body)]));
}
export function audit(db) {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  auditProjection(db);
  const a = artifactsFrom(db), parsed = facts(a);
  const rows = db.prepare('SELECT * FROM native').all();
  assert.equal(rows.length, 1);
  assert.deepEqual({...rows[0]}, parsed, 'derived native fact drift');
  for (const [table, expected] of Object.entries(a.manifest.baseline_tables)) {
    assert.equal(
        hash(JSON.stringify(db.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all())), expected,
        'historical rows modified ' + table);
  }
  return parsed;
}
function main() {
  if (process.argv[2] === '--audit') {
    assert.equal(process.argv.length, 4);
    const db = new DatabaseSync(resolve(process.argv[3]), {readOnly: true});
    try {
      console.log(JSON.stringify({status: 'PASS', ...audit(db)}));
    } finally {
      db.close();
    }
    return;
  }
  assert.equal(process.argv.length, 6, 'base.sqlite proof-directory source-commit fresh-output');
  const [base, proof, commit, out] = process.argv.slice(2).map((v, i) => i === 2 ? v : resolve(v));
  assert.ok(!existsSync(out));
  assert.ok(!existsSync(base + '-wal'));
  sha(commit, 40);
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const git = (...args) => {
    const r = spawnSync('git', args, {cwd: repo, timeout: 10000});
    assert.equal(r.status, 0, String(r.stderr));
    assert.ifError(r.error);
    return r.stdout;
  };
  const source_tree = git('rev-parse', commit + '^{tree}').toString().trim(),
        probe_tree = git('rev-parse', commit + ':tools/projfs-probe').toString().trim(),
        cpp_blob = git('rev-parse', commit + ':tools/winfsp-probe.cpp').toString().trim();
  const raw = Object.fromEntries(Object.entries(inputs).map(
      ([name, file]) => [name, readFileSync(join(proof, file), 'utf8')]));
  const a = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, JSON.parse(v)]));
  const paths =
      {host: a.native.exe, winfsp: a.native.dll, bridge: a.native.bridge, client: a.native.checker};
  const observed_binary_sha256 =
      Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, hash(readFileSync(v))]));
  const baseline_sha256 = hash(readFileSync(base));
  const src = new DatabaseSync(base, {readOnly: true});
  let baseline_tables;
  try {
    auditProjection(src);
    baseline_tables = Object.fromEntries([
      'identity', 'preflight', 'receipts', 'projection', 'projection_artifacts'
    ].map(t => [t, hash(JSON.stringify(src.prepare('SELECT * FROM ' + t + ' ORDER BY 1').all()))]));
    assert.equal(
        src.prepare(
               'SELECT count(*) n FROM receipts WHERE group_name=\'workspace-proof\' AND status=\'NOT_RUN\'')
            .get()
            .n,
        3);
  } finally {
    src.close();
  }
  const harness_sha256 = Object.fromEntries([
    'tools/winfsp-smoke.mjs', 'tools/winfsp-cache-test.mjs', 'tools/winfsp-concurrent-test.mjs',
    'tools/winfsp-close-test.mjs'
  ].map(p => [p, hash(git('show', commit + ':' + p))]));
  a.manifest = {
    imported_at: new Date().toISOString(),
    source_commit: commit,
    source_tree,
    probe_tree,
    cpp_blob,
    cpp_sha256: hash(git('show', commit + ':tools/winfsp-probe.cpp')),
    tested_tree: lines(command(a.source_seal))[0],
    harness_sha256,
    observed_binary_sha256,
    baseline_sha256,
    baseline_tables,
    evidence_kind: 'retained-native-diagnostic',
    source_attribution: 'declared source plus byte checks; not build attestation'
  };
  assert.equal(
      git('rev-parse', a.manifest.tested_tree + ':tools/projfs-probe').toString().trim(),
      probe_tree);
  assert.equal(
      git('rev-parse', a.manifest.tested_tree + ':tools/winfsp-probe.cpp').toString().trim(),
      cpp_blob);
  for (const [p, h] of Object.entries(harness_sha256))
    assert.equal(hash(git('show', a.manifest.tested_tree + ':' + p)), h);
  raw.manifest = JSON.stringify(a.manifest, null, 2);
  const row = facts(a);
  mkdirSync(out, {recursive: true});
  copyFileSync(base, join(out, 'snapshot.sqlite'));
  const db = new DatabaseSync(join(out, 'snapshot.sqlite'));
  try {
    db.exec(
        'CREATE TABLE native (' +
        Object.entries(row)
            .map(
                ([k, v]) => k +
                    (k === 'id'                ? ' INTEGER PRIMARY KEY' :
                         typeof v === 'number' ? ' INTEGER' :
                                                 ' TEXT'))
            .join(',') +
        '); CREATE TABLE native_artifacts(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,body TEXT NOT NULL)');
    db.prepare('INSERT INTO native VALUES (' + Object.keys(row).map(() => '?').join(',') + ')')
        .run(...Object.values(row));
    const put = db.prepare('INSERT INTO native_artifacts VALUES (?,?,?)');
    for (const [name, body] of Object.entries(raw)) put.run(name, hash(body), body);
    audit(db);
  } finally {
    db.close();
  }
  assert.equal(hash(readFileSync(base)), baseline_sha256);
  writeFileSync(
      join(out, 'import.json'),
      JSON.stringify(
          {
            baseline: base,
            proof,
            ...a.manifest,
            facts: row,
            artifacts: Object.entries(raw).map(([name, body]) => ({name, sha256: hash(body)})),
            snapshot_sha256: hash(readFileSync(join(out, 'snapshot.sqlite')))
          },
          null, 2));
  console.log(
      'PASS retained native import: 16 raw artifacts, five runs, baseline untouched; product Workspace remains unqualified');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
