// Retained lifecycle import only: never mounts, runs Git, or modifies a source Store.
// node lifecycle.mjs <closed-native-baseline> <fresh-output> | --audit <snapshot>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {audit as auditNative, hash} from './native.mjs';
import {auditReceipt} from '../../../winfsp-handle-trace.mjs';
import {auditCoordination} from '../../../winfsp-reopen-test.mjs';
export {hash};
export const inputs = {
  git: 'tmp/native-git-close-20261102/file-trace/result.json',
  checkpoint: 'tmp/native-git-close-20261102/file-trace/data-checkpoint.json',
  before: 'tmp/native-git-close-20261102/file-trace/before.json',
  git_command: 'tmp/native-git-close-20261102/file-trace-command.json',
  mapping: 'tmp/native-git-close-20261102/mapping-final/result.json',
  mapping_guard: 'tmp/native-git-close-20261102/mapping-final/guard.json',
  mapping_invalid: 'tmp/native-git-close-20261102/mapping-final/invalid-mode.json',
  reopen: 'tmp/native-reopen-20261102/final/result.json',
  reopen_guard: 'tmp/native-reopen-20261102/final/guard.json',
  metadata: 'tmp/native-git-20261102/native-metadata-final.json',
  overlay_metadata: 'tmp/native-git-20261102/product-windows-attributes.json',
  host_build: 'tmp/native-git-close-20261102/host-trace.json',
  mapping_build: 'tmp/native-git-close-20261102/build-final.json',
  reopen_build: 'tmp/native-reopen-20261102/build-final.json',
  reopen_source: 'tmp/native-reopen-20261102/loc-comparison.json',
  mapping_source: 'tmp/native-git-close-20261102/loc-comparison.json',
  ...Object.fromEntries(Array.from(
      {length: 20},
      (_, i) =>
          ['command_' + String(i + 1).padStart(2, '0'),
           'tmp/native-git-close-20261102/file-trace/' + String(i + 1).padStart(2, '0') + '.json']))
};
const baselineTables = [
  'identity', 'preflight', 'receipts', 'projection', 'projection_artifacts', 'native',
  'native_artifacts'
];
const sources = {
  metadata: {
    commit: 'd6e45c0eda39651041b78b0581c22046dfdfbd23',
    tested: 'ff1a9bc7601a4908860df2ac5b9775d373e54381',
    paths: [
      'engine/crates/layerfs-overlay', 'engine/crates/layerfs-workspace',
      'tools/projfs-probe/src/native_metadata.rs', 'tools/projfs-probe/tests/native_metadata.rs'
    ]
  },
  mapping: {
    commit: 'ff4bd47cb92d38ba8bc66eb85ad88748a8566afe',
    tested: '3756d8dc0dd710f96d27249028ee4199582cebb8',
    paths: [
      'tools/projfs-probe/src', 'tools/winfsp-probe.cpp', 'tools/winfsp-mapping-lifetime-test.mjs'
    ]
  },
  reopen: {
    commit: '08fa9b0d3ba0be698c2757131d2ac2804c91b63e',
    tested: '62a21bfc03787f2766a73254dc7d20b682835737',
    paths: ['tools/projfs-probe/src', 'tools/winfsp-probe.cpp', 'tools/winfsp-reopen-test.mjs']
  }
};
function command(r, exit = 0) {
  assert.equal(r.kind, 'foreground');
  assert.equal(r.exitCode, exit);
  assert.equal(r.signal, null);
  assert.equal(r.timedOut, false);
  assert.equal(r.aborted, false);
  assert.equal(r.stdout.truncated, false);
  assert.equal(r.stderr.truncated, false);
  return r.stdout.text;
}
function child(r) {
  assert.equal(r.exit, 0);
  assert.equal(r.signal, null);
  assert.equal(r.error, null);
  const a = Date.parse(r.started), b = Date.parse(r.finished);
  assert.ok(Number.isFinite(a) && b >= a && b - a <= 120000);
  assert.equal(typeof r.stdout, 'string');
  assert.equal(typeof r.stderr, 'string');
}
function guarded(r, reason) {
  assert.equal(r.exit, 1);
  assert.equal(r.signal, null);
  assert.equal(r.error, null);
  assert.match(r.stderr, reason);
}
function build(r) {
  assert.equal(r.job.status, 'completed');
  assert.equal(r.job.detail, 'exit code: 0');
  assert.match(r.job.label, /--offline --locked/);
  assert.match(r.job.label, /--no-run/);
  assert.match(r.job.label, /clippy.*-D warnings/);
}
function checkpoints(r, second) {
  assert.deepEqual(r, {
    git_created: true,
    first_layerfs_commit: true,
    remount_bytes_exact: true,
    git_history_verified: true,
    second_layerfs_commit: second,
    normal_close_complete: false
  });
}
function verifyManifest(m) {
  assert.equal(m.kind, 'retained-lifecycle-evidence');
  assert.ok(Number.isFinite(Date.parse(m.imported_at)));
  assert.match(m.baseline_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(m.baseline_tables).sort(), [...baselineTables].sort());
  for (const h of Object.values(m.baseline_tables)) assert.match(h, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(m.sources), Object.keys(sources));
  for (const [k, expected] of Object.entries(sources)) {
    const s = m.sources[k];
    assert.equal(s.commit, expected.commit);
    assert.equal(s.tested, expected.tested);
    assert.match(s.tree, /^[0-9a-f]{40}$/);
    assert.deepEqual(Object.keys(s.blobs), expected.paths);
    for (const b of Object.values(s.blobs)) assert.match(b, /^[0-9a-f]{40}$/);
  }
  assert.equal(m.git_run_harness_hash, 'not-recorded-in-original-run');
  assert.equal(m.old_binary_recheck, 'not-available-after-shared-build-replacement');
  assert.equal(m.provenance, 'declared-source-and-retained-receipts-not-build-attestation');
  for (const [p, h] of Object.entries(m.analyzers)) {
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(
        h, hash(readFileSync(new URL('../../../../' + p, import.meta.url))),
        'analysis code drift ' + p);
  }
  assert.deepEqual(
      Object.keys(m.analyzers), ['tools/winfsp-handle-trace.mjs', 'tools/winfsp-reopen-test.mjs']);
  assert.deepEqual(m.observed_current_reopen_sha256, m.reopen_identity);
}
export function facts(a) {
  assert.deepEqual(Object.keys(a).sort(), [...Object.keys(inputs), 'manifest'].sort());
  const m = a.manifest;
  verifyManifest(m);
  const g = a.git, c = a.checkpoint;
  assert.equal(g.status, 'FAIL');
  assert.equal(g.failure, 'AssertionError [ERR_ASSERTION]: phase close-idle');
  assert.equal(g.workspace_qualified, false);
  checkpoints(g.checkpoints, true);
  checkpoints(c.checkpoints, false);
  assert.equal(c.normal_close_qualified, false);
  for (const h of Object.values(g.identity)) assert.match(h, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(g.identity), ['host', 'winfsp', 'bridge', 'checker', 'git']);
  command(a.git_command, 1);
  assert.match(a.git_command.stderr.text, /phase close-idle/);
  assert.equal(g.commands.length, 20);
  const records =
      Array.from({length: 20}, (_, i) => a['command_' + String(i + 1).padStart(2, '0')]);
  records.forEach(child);
  for (const [i, r] of records.entries())
    assert.deepEqual(
        g.commands[i],
        {file: String(i + 1).padStart(2, '0') + '.json', exe: r.exe, args: r.args, exit: 0});
  assert.deepEqual(records[0].args.slice(0, 1), ['binding-setup']);
  assert.match(
      records[0].stdout, /EXPLICIT_STORE_SETUP initialized_once=true synthetic_input=true/);
  assert.deepEqual(records[1].args, ['--version']);
  assert.equal(records[1].stdout, c.version);
  assert.equal(c.version, 'git version 2.46.0.windows.1\n');
  const [first, second] = c.git_commits;
  assert.match(first, /^[0-9a-f]{40}$/);
  assert.match(second, /^[0-9a-f]{40}$/);
  assert.notEqual(first, second);
  const expected = [
    ['init', '--initial-branch=main'], ['add', '.gitignore', 'tracked.txt'],
    ['commit', '-m', 'native first'], ['rev-parse', 'HEAD'], ['status', '--porcelain'],
    ['add', '-A'], ['commit', '-m', 'native second'], ['rev-parse', 'HEAD'], ['rev-parse', 'HEAD^'],
    ['status', '--porcelain'], ['fsck', '--full'], ['check-ignore', 'ignored/cache.bin'],
    ['rev-parse', 'HEAD'], ['rev-parse', 'HEAD^'], ['status', '--porcelain'], ['fsck', '--full'],
    ['show', 'HEAD:renamed.txt'], ['show', first + ':tracked.txt']
  ];
  for (const [i, args] of expected.entries()) {
    const r = records[i + 2];
    assert.equal(r.exe, records[1].exe);
    assert.deepEqual(
        r.args.slice(0, 5), ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-C']);
    assert.deepEqual(r.args.slice(6), args);
    const provider = i < 12 ? g.providers[0] : g.providers[1];
    assert.equal(r.args[5].replaceAll('\\', '/'), provider.args[1].replaceAll('\\', '/') + '/repo');
  }
  for (const [i, value] of [[5, first], [9, second], [10, first], [14, second], [15, first]])
    assert.equal(records[i].stdout.trim(), value);
  for (const i of [6, 11, 16]) assert.equal(records[i].stdout, '');
  for (const i of [12, 17]) assert.equal(records[i].stdout, '');
  assert.equal(records[13].stdout.trim(), 'ignored/cache.bin');
  assert.equal(records[18].stdout, 'second native revision\n');
  assert.equal(records[19].stdout, 'first native revision\n');
  assert.equal(c.git_commands, 20);
  assert.equal(c.files, 17);
  assert.equal(a.before.length, 17);
  const names = a.before.map(v => v.path);
  assert.equal(new Set(names).size, 17);
  for (const f of a.before) {
    assert.ok(Number.isSafeInteger(f.bytes) && f.bytes >= 0);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.ok(!f.path.startsWith('/') && !f.path.split('/').includes('..'));
  }
  for (const n
           of ['.git/index', '.git/HEAD', '.git/refs/heads/main', 'ignored/cache.bin',
               'renamed.txt'])
    assert.ok(names.includes(n));
  assert.equal(names.filter(n => n.startsWith('.git/objects/')).length, 7);
  assert.ok(!names.some(n => n.endsWith('.lock')));
  const traces = auditReceipt(g);
  assert.deepEqual(traces.map(p => p.provider), ['first', 'second']);
  assert.equal(traces[0].normal_close, true);
  assert.equal(traces[1].normal_close, false);
  assert.equal(traces[1].outstanding.length, 8);
  assert.deepEqual(g.providers[0].args.slice(3), g.providers[1].args.slice(3));
  for (const p of g.providers) {
    assert.match(p.stdout, /STORE_REBOUND existing=true init=false/);
    assert.doesNotMatch(p.stdout, /STORE_CREATED/);
    assert.match(p.stdout, /profile=Disposable overlay=MEMORY_OFF_EXCLUSIVE/);
  }
  const committed =
      /OVERLAY_COMMIT kind=Committed scope=published id=CommitId\(([0-9a-f]{66})\) root=ObjectId\("([0-9a-f]{64})"\) parent=None via=Workspace/
          .exec(g.providers[0].stdout);
  assert.ok(committed);
  assert.match(
      g.providers[1].stdout,
      new RegExp(
          'kind=UpToDate scope=published head=Some\\(CommitId\\(' + committed[1] +
          '\\)\\) root=ObjectId\\("' + committed[2] + '"\\) new_commit=false'));
  const outstanding = traces[1].outstanding;
  assert.equal(outstanding.filter(h => h.open.name.endsWith('\\.git\\index')).length, 1);
  assert.equal(outstanding.filter(h => h.open.name.includes('\\.git\\objects\\')).length, 7);
  for (const h of outstanding) assert.equal(parseInt(h.open.flags, 16) & 6, 0);
  const hostText = command(a.host_build), host = JSON.parse(hostText.slice(hostText.indexOf('{')));
  assert.equal(host.binarySha256.toLowerCase(), g.identity.host);
  assert.equal(host.binarySha256.toLowerCase(), a.mapping.identity.host);
  assert.equal(host.binarySha256.toLowerCase(), a.reopen.identity.host);
  assert.match(host.sourceSha256, /^[A-Fa-f0-9]{64}$/);
  const metadata = command(a.metadata), overlay = command(a.overlay_metadata);
  assert.match(metadata, /test result: ok\. 2 passed; 0 failed/);
  assert.match(metadata, /test persisted_flags_capture_rights_unlink_and_rebind \.\.\. ok/);
  assert.match(metadata, /test dot_parent_tracks_directory_move_and_empty_listing \.\.\. ok/);
  assert.match(overlay, /test windows_flags_follow_capture_and_orphan_ownership \.\.\. ok/);
  assert.match(overlay, /test result: ok\. 1 passed; 0 failed/);
  const mapping = auditReceipt(a.mapping);
  assert.deepEqual(mapping.map(v => v.provider), ['read', 'view-first', 'file-first']);
  assert.deepEqual(mapping.map(v => v.normal_close), [true, true, false]);
  assert.equal(mapping[2].outstanding.length, 1);
  assert.equal(parseInt(mapping[2].outstanding[0].open.flags, 16) & 6, 0);
  guarded(a.mapping_guard, /requires diagnostic parent/);
  guarded(a.mapping_invalid, /unknown lifetime order/);
  build(a.mapping_build);
  const reopen = auditCoordination(a.reopen);
  guarded(a.reopen_guard, /requires diagnostic parent/);
  build(a.reopen_build);
  assert.deepEqual(a.reopen.identity, m.reopen_identity);
  assert.equal(a.reopen.identity.winfsp, g.identity.winfsp);
  assert.equal(a.mapping.identity.winfsp, g.identity.winfsp);
  assert.equal(a.mapping_source.tested_tree, m.sources.mapping.tested);
  assert.equal(a.reopen_source.tested_tree, m.sources.reopen.tested);
  assert.equal(a.reopen_source.parent, m.sources.mapping.commit);
  const times = [...g.providers, ...a.mapping.cases, a.reopen.provider];
  for (const p of times) assert.ok(Date.parse(p.finished) <= Date.parse(m.imported_at));
  const common = {
    id: 1,
    imported_at: m.imported_at,
    identity_checked: 1,
    artifact_count: Object.keys(a).length,
    qualification: 0
  };
  return {
    git: {
      ...common,
      source_commit: m.sources.mapping.commit,
      metadata_source: m.sources.metadata.commit,
      started: g.providers[0].started,
      ended: g.providers[1].finished,
      git_commands: 19,
      git_commits: 2,
      layerfs_new_commits: 1,
      second_up_to_date: 1,
      manifest_files: 17,
      objects: 7,
      remount_checkpoint: 1,
      independent_after_manifest: 0,
      metadata_tests: 3,
      close_complete: 0,
      remaining_handles: 8,
      raw_status: g.status,
      cleanup: traces[1].cleaned,
      closed: traces[1].closed,
      nonpromotion: 1
    },
    lifecycle: {
      ...common,
      source_commit: m.sources.reopen.commit,
      tested_tree: m.sources.reopen.tested,
      started: a.mapping.cases[0].started,
      ended: a.reopen.provider.finished,
      ordinary_close: 1,
      view_first_close: 1,
      file_first_busy: 1,
      file_first_remaining: 1,
      busy_readable: 1,
      live_view_readable: 1,
      no_early_close: 1,
      owner_released: 1,
      original_close_after_reopen: 1,
      new_stop_detached: 1,
      original_handle: reopen.original_handle,
      unmap_observation_ms: reopen.unmapped_observation_ms,
      general_close_qualified: 0,
      guard_refusals: 3,
      nonpromotion: 1
    }
  };
}
export function audit(db) {
  auditNative(db);
  const raw = db.prepare('SELECT * FROM lifecycle_artifacts ORDER BY name').all();
  assert.deepEqual(raw.map(r => r.name), [...Object.keys(inputs), 'manifest'].sort());
  for (const r of raw) assert.equal(hash(r.body), r.sha256);
  const a = Object.fromEntries(raw.map(r => [r.name, JSON.parse(r.body)]));
  const rows = facts(a);
  for (const [key, table] of [['git', 'git_evidence'], ['lifecycle', 'lifecycle_evidence']]) {
    const actual = db.prepare('SELECT * FROM ' + table).all();
    assert.equal(actual.length, 1);
    assert.deepEqual({...actual[0]}, rows[key]);
  }
  for (const [t, h] of Object.entries(a.manifest.baseline_tables))
    assert.equal(
        hash(JSON.stringify(db.prepare('SELECT * FROM ' + t + ' ORDER BY 1').all())), h,
        'baseline drift ' + t);
  return rows;
}
function main() {
  if (process.argv[2] === '--audit') {
    const db = new DatabaseSync(resolve(process.argv[3]), {readOnly: true});
    try {
      console.log(JSON.stringify({status: 'PASS', facts: audit(db)}));
    } finally {
      db.close();
    }
    return;
  }
  assert.equal(process.argv.length, 4, 'closed-native-baseline fresh-output');
  const base = resolve(process.argv[2]), out = resolve(process.argv[3]);
  assert.ok(!existsSync(out));
  assert.ok(!existsSync(base + '-wal'));
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const raw = Object.fromEntries(
      Object.entries(inputs).map(([k, v]) => [k, readFileSync(join(repo, v), 'utf8')]));
  const a = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, JSON.parse(v)]));
  const git = (...args) => {
    const r = spawnSync('git', args, {cwd: repo, timeout: 10000});
    assert.ifError(r.error);
    assert.equal(r.status, 0, String(r.stderr));
    return String(r.stdout).trim();
  };
  const attributed = Object.fromEntries(Object.entries(sources).map(([k, s]) => {
    const blobs = Object.fromEntries(s.paths.map(p => {
      const actual = git('rev-parse', s.commit + ':' + p);
      assert.equal(actual, git('rev-parse', s.tested + ':' + p));
      return [p, actual];
    }));
    return [k, {...s, tree: git('rev-parse', s.commit + '^{tree}'), blobs}];
  }));
  const src = new DatabaseSync(base, {readOnly: true});
  let tables;
  try {
    auditNative(src);
    tables = Object.fromEntries(baselineTables.map(
        t => [t, hash(JSON.stringify(src.prepare('SELECT * FROM ' + t + ' ORDER BY 1').all()))]));
  } finally {
    src.close();
  }
  // Old DLLs were replaced by later shared builds: retain their recorded identities,
  // never silently compare them with today's different DLL or invent a build seal.
  const rp = a.reopen.provider;
  const observed = {
    host: hash(readFileSync(rp.exe)),
    winfsp: hash(readFileSync(rp.args[0])),
    bridge: hash(readFileSync(rp.args[3])),
    client: hash(readFileSync(a.reopen.application.exe))
  };
  a.manifest = {
    kind: 'retained-lifecycle-evidence',
    imported_at: new Date().toISOString(),
    baseline_sha256: hash(readFileSync(base)),
    baseline_tables: tables,
    sources: attributed,
    reopen_identity: a.reopen.identity,
    observed_current_reopen_sha256: observed,
    git_run_harness_hash: 'not-recorded-in-original-run',
    old_binary_recheck: 'not-available-after-shared-build-replacement',
    provenance: 'declared-source-and-retained-receipts-not-build-attestation',
    analyzers:
        Object.fromEntries(['tools/winfsp-handle-trace.mjs', 'tools/winfsp-reopen-test.mjs'].map(
            p => [p, hash(readFileSync(join(repo, p)))]))
  };
  raw.manifest = JSON.stringify(a.manifest, null, 2);
  const rows = facts(a);
  mkdirSync(out, {recursive: true});
  copyFileSync(base, join(out, 'snapshot.sqlite'));
  const db = new DatabaseSync(join(out, 'snapshot.sqlite'));
  try {
    db.exec(
        'CREATE TABLE lifecycle_artifacts(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,body TEXT NOT NULL)');
    for (const [key, table] of [['git', 'git_evidence'], ['lifecycle', 'lifecycle_evidence']]) {
      const row = rows[key];
      db.exec(
          'CREATE TABLE ' + table + '(' +
          Object.entries(row)
              .map(
                  ([k, v]) => k +
                      (k === 'id'                ? ' INTEGER PRIMARY KEY' :
                           typeof v === 'number' ? ' INTEGER' :
                                                   ' TEXT'))
              .join(',') +
          ')');
      db.prepare(
            'INSERT INTO ' + table + ' VALUES(' + Object.keys(row).map(() => '?').join(',') + ')')
          .run(...Object.values(row));
    }
    const put = db.prepare('INSERT INTO lifecycle_artifacts VALUES(?,?,?)');
    for (const [k, body] of Object.entries(raw)) put.run(k, hash(body), body);
    audit(db);
  } finally {
    db.close();
  }
  assert.equal(hash(readFileSync(base)), a.manifest.baseline_sha256);
  writeFileSync(
      join(out, 'import.json'),
      JSON.stringify(
          {
            base,
            ...a.manifest,
            facts: rows,
            snapshot_sha256: hash(readFileSync(join(out, 'snapshot.sqlite')))
          },
          null, 2));
  console.log(JSON.stringify(
      {status: 'IMPORTED', git_normal_close: 'FAIL', lifecycle_observation: 'PASS', facts: rows}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
