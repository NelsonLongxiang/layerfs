// Two real native processes, one Store, distinct caller-owned Workspace identities.
// node tools/winfsp-binding-test.mjs <host> <WinFsp-dll> <Rust-dll> <checker> <fresh-output>
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, readSync, writeSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
assert.equal(process.platform, 'win32');
assert.equal(process.argv.length, 7);
const [host, dll, bridge, checker, out] = process.argv.slice(2).map(p => resolve(p));
assert.ok(!existsSync(out), 'fresh output required');
mkdirSync(out);
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const identity = {
  host: hash(host),
  winfsp: hash(dll),
  bridge: hash(bridge),
  checker: hash(checker)
};
// Synthetic test authority only. Input is never put in argv, logs, or a file.
const catalog = Buffer.from('explicit-native-binding-test-v1'), cursor = Buffer.alloc(32, 91);
const branch = Buffer.concat([Buffer.from([0x11]), Buffer.alloc(16, 41)]);
const workspaceA = randomBytes(32), workspaceB = randomBytes(32), workspaceC = randomBytes(32);
assert.notDeepEqual(workspaceA, workspaceB);
function frame(workspace) {
  const length = Buffer.alloc(2);
  length.writeUInt16LE(catalog.length);
  return Buffer.concat([Buffer.from('LFSBND01'), length, catalog, cursor, branch, workspace]);
}
function cli(name, args, input, env = process.env, ms = 15000) {
  const r = spawnSync(checker, args, {input, env, encoding: 'utf8', timeout: ms});
  const record = {
    args,
    exit: r.status,
    signal: r.signal,
    error: r.error?.message ?? null,
    stdout: r.stdout,
    stderr: r.stderr
  };
  writeFileSync(join(out, name + '.json'), JSON.stringify(record, null, 2));
  assert.ifError(r.error);
  assert.equal(r.signal, null);
  return record;
}
const root = join(out, 'fixture');
const guard = cli('setup-guard', ['binding-setup', root], frame(workspaceA));
assert.equal(guard.exit, 1);
assert.match(guard.stderr, /requires diagnostic parent/);
const setup =
    cli('setup', ['binding-setup', root], frame(workspaceA),
        {...process.env, LAYERFS_PROJFS_PROBE_CHILD_ROOT: root}, 45000);
assert.equal(setup.exit, 0, setup.stderr);
assert.match(setup.stdout, /EXPLICIT_STORE_SETUP initialized_once=true synthetic_input=true/);
const store = join(root, 'store.sqlite');
const badFrames = [
  ['empty', Buffer.alloc(0), 'c000000d'],
  ['truncated', frame(workspaceA).subarray(0, -1), 'c000000d'],
  ['trailing', Buffer.concat([frame(workspaceA), Buffer.from([1])]), 'c000000d'],
  ['zero-workspace', frame(Buffer.alloc(32)), 'c000000d'],
  [
    'missing-branch', (() => {
      const v = frame(workspaceA);
      v.fill(99, 43 + catalog.length, 59 + catalog.length);
      return v;
    })(),
    'c0000034'
  ],
  [
    'wrong-catalog', (() => {
      const v = frame(workspaceA);
      v[10] ^= 1;
      return v;
    })(),
    'c0000001'
  ],
];
for (const [name, input, status] of badFrames) {
  const local = join(out, 'refused-' + name);
  mkdirSync(local);
  const mount = join(local, 'mount'), control = join(local, 'control');
  const r = spawnSync(
      host, [dll, mount, control, bridge, '--bind-stdin', store],
      {input, encoding: 'utf8', timeout: 8000});
  const receipt = {
    exit: r.status,
    signal: r.signal,
    error: r.error?.message ?? null,
    stdout: r.stdout,
    stderr: r.stderr
  };
  writeFileSync(join(local, 'result.json'), JSON.stringify(receipt, null, 2));
  assert.ifError(r.error);
  assert.equal(r.status, 1);
  assert.equal(r.signal, null);
  assert.match(r.stderr, new RegExp('OVERLAY_BIND_FAIL status=' + status));
  assert.equal(existsSync(mount), false);
  assert.equal(existsSync(join(control, 'ready')), false);
  assert.doesNotMatch(r.stdout, /NATIVE_BIND_READY|OVERLAY_BOUND/);
  assert.ok(!r.stderr.includes(catalog.toString()));
}
function launch(label, workspace) {
  const local = join(out, label);
  mkdirSync(local);
  const mount = join(local, 'mount'), control = join(local, 'control');
  const args = [dll, mount, control, bridge, '--bind-stdin', store];
  const record = {
    label,
    args,
    workspace: workspace.toString('hex'),
    started: new Date().toISOString(),
    stdout: '',
    stderr: '',
    exit: null,
    error: null
  };
  const child = spawn(host, args, {stdio: ['pipe', 'pipe', 'pipe']});
  child.stdin.on('error', e => {
    record.error = e.message;
  });
  child.stdin.end(frame(workspace));
  child.stdout.on('data', d => {
    record.stdout += d;
  });
  child.stderr.on('data', d => {
    record.stderr += d;
  });
  const ended = new Promise(resolve => {
    child.once('error', e => {
      record.error = e.message;
      resolve(record);
    });
    child.once('exit', (code, signal) => {
      record.exit = {code, signal};
      record.finished = new Date().toISOString();
      resolve(record);
    });
  });
  return {local, mount, control, record, child, ended};
}
const processes = [];
let failure = null, ha, hb;
const timer = setTimeout(() => {
  failure = 'dual native binding deadline 55 seconds';
  for (const p of processes)
    if (p.child.exitCode === null && !p.child.killed) p.child.kill();
}, 55000);
async function phase(p, name) {
  const end = Date.now() + 12000;
  while (!existsSync(join(p.control, name))) {
    assert.equal(p.record.exit, null, p.record.stdout + p.record.stderr);
    assert.equal(p.record.error, null);
    assert.ok(Date.now() < end, p.record.label + ' phase ' + name);
    await new Promise(r => setTimeout(r, 5));
  }
}
function mark(p, name) {
  writeFileSync(join(p.control, name), 'request', {flag: 'wx'});
}
async function commit(p, n) {
  mark(p, 'binding-commit-' + n);
  await phase(p, 'binding-committed-' + n);
}
async function close(p, after = false) {
  mark(p, 'close-inspect');
  await phase(p, 'close-idle');
  mark(p, after ? 'stop-after-release' : 'stop');
  const r = await p.ended;
  assert.equal(r.exit?.code, 0, r.stdout + r.stderr);
  assert.equal(r.exit?.signal, null);
  assert.equal(r.error, null);
  assert.equal(existsSync(p.mount), false);
}
function current(fd) {
  const b = Buffer.alloc(5);
  assert.equal(readSync(fd, b, 0, 5, 0), 5);
  return b.toString();
}
function overlays(p) {
  return readdirSync(join(p.control, 'store'))
      .filter(n => /^\d+[.]sqlite$/.test(n))
      .map(n => join(p.control, 'store', n));
}
try {
  const a = launch('a', workspaceA);
  processes.push(a);
  await phase(a, 'ready');
  const b = launch('b', workspaceB);
  processes.push(b);
  await phase(b, 'ready');
  assert.equal(readFileSync(join(a.mount, 'alpha.txt'), 'utf8'), 'old immutable Store version\n');
  assert.equal(readFileSync(join(b.mount, 'alpha.txt'), 'utf8'), 'old immutable Store version\n');
  const ao = overlays(a), bo = overlays(b);
  assert.equal(ao.length, 1);
  assert.equal(bo.length, 1);
  assert.notEqual(ao[0], bo[0]);
  const events = [];
  ha = openSync(join(a.mount, 'a.txt'), 'wx+');
  writeSync(ha, Buffer.from('alpha'), 0, 5, 0);
  hb = openSync(join(b.mount, 'b.txt'), 'wx+');
  writeSync(hb, Buffer.from('bravo'), 0, 5, 0);
  assert.equal(existsSync(join(a.mount, 'b.txt')), false);
  assert.equal(existsSync(join(b.mount, 'a.txt')), false);
  events.push('both-local-writes-isolated');
  await commit(a, 0);
  assert.equal(existsSync(join(b.mount, 'a.txt')), false, 'A Commit must not refresh B local base');
  assert.equal(current(hb), 'bravo');
  events.push('a-published-b-local-still-pinned');
  await commit(b, 0);
  assert.equal(readFileSync(join(b.mount, 'a.txt'), 'utf8'), 'alpha');
  assert.equal(current(hb), 'bravo');
  assert.equal(existsSync(join(a.mount, 'b.txt')), false, 'B Commit must not refresh A local base');
  assert.equal(current(ha), 'alpha');
  events.push('b-merged-publications-a-local-still-pinned');
  mark(a, 'stop');
  await phase(a, 'stop-refused');
  assert.equal(current(ha), 'alpha');
  assert.equal(current(hb), 'bravo');
  closeSync(ha);
  ha = undefined;
  await close(a, true);
  assert.equal(existsSync(ao[0]), false);
  assert.equal(existsSync(bo[0]), true);
  assert.equal(b.record.exit, null);
  assert.equal(current(hb), 'bravo');
  writeSync(hb, Buffer.from('after'), 0, 5, 0);
  await commit(b, 1);
  assert.equal(current(hb), 'after');
  events.push('a-closed-b-still-usable');
  closeSync(hb);
  hb = undefined;
  await close(b);
  assert.equal(existsSync(bo[0]), false);
  const reopened = cli('reopen', ['binding-verify', store], frame(workspaceC));
  assert.equal(reopened.exit, 0, reopened.stdout + reopened.stderr);
  assert.match(reopened.stdout, /REOPEN_BINDING_PASS commits=3/);
  const c = launch('c', workspaceC);
  processes.push(c);
  await phase(c, 'ready');
  assert.equal(readFileSync(join(c.mount, 'a.txt'), 'utf8'), 'alpha');
  assert.equal(readFileSync(join(c.mount, 'b.txt'), 'utf8'), 'after');
  await commit(c, 0);
  assert.match(c.record.stdout, /EXPLICIT_BIND_COMMIT index=0 changed=0 scope=published/);
  await close(c);
  const after = cli('reopen-after', ['binding-verify', store], frame(workspaceC));
  assert.equal(after.exit, 0, after.stderr);
  assert.equal(after.stdout, reopened.stdout);
  events.push('fresh-mount-latest-head-no-new-commit');
  for (const p of processes) {
    const s = p.record.stdout;
    assert.match(s, /NATIVE_BIND_READY existing_store=true init=false stdin_only=true/);
    assert.doesNotMatch(s, /STORE_CREATED/);
    assert.match(s, /OVERLAY_BOUND .*profile=Disposable overlay=MEMORY_OFF_EXCLUSIVE/);
    assert.ok(s.includes('workspace=WorkspaceId(' + p.record.workspace + ')'));
    assert.match(s, /NORMAL_CLOSE_DONE detach=true overlay_closed=true/);
    assert.match(s, /OVERLAY_STATE .*handles=0/);
    assert.match(s, /errors=0/);
    assert.doesNotMatch(s, new RegExp(cursor.toString('hex')));
    assert.ok(!s.includes(catalog.toString()));
  }
  const commits = processes.flatMap(
      p =>
          [...p.record.stdout.matchAll(
               /OVERLAY_COMMIT kind=Committed scope=published id=CommitId\(([0-9a-f]+)\).*parent=(None|Some\(CommitId\(([0-9a-f]+)\)\)) via=Workspace/g)]
              .map(m => ({id: m[1], parent: m[3] ?? null})));
  const history = [
    ...reopened.stdout.matchAll(
        /BINDING_HISTORY index=(\d+) id=CommitId\(([0-9a-f]+)\) parent=(None|Some\(CommitId\(([0-9a-f]+)\)\)) via=Workspace/g)
  ];
  assert.equal(commits.length, 3);
  assert.deepEqual(commits.map(r => r.id), history.map(m => m[2]));
  assert.deepEqual(commits.map(r => r.parent), [null, commits[0].id, commits[1].id]);
  for (const [key, p] of Object.entries({host, winfsp: dll, bridge, checker}))
    assert.equal(hash(p), identity[key]);
  writeFileSync(
      join(out, 'observations.json'),
      JSON.stringify(
          {
            events,
            store,
            workspace_ids: processes.map(p => p.record.workspace),
            overlay_files: [ao[0], bo[0]],
            commits,
            stdin_recorded: false,
            product_workspace_qualified: false
          },
          null, 2));
  console.log(
      'PASS explicit native bindings: simultaneous same-Store mounts, isolated local views, merged Commit ancestry, independent close, fresh remount and read-only History');
} catch (e) {
  failure = String(e);
  for (const h of [ha, hb])
    if (h !== undefined) {
      try {
        closeSync(h);
      } catch {
      }
    }
  for (const p of processes)
    if (p.child.exitCode === null && !p.child.killed) p.child.kill();
  await Promise.all(processes.map(p => p.ended));
  throw e;
} finally {
  clearTimeout(timer);
  writeFileSync(
      join(out, 'result.json'),
      JSON.stringify(
          {
            status: failure ? 'FAIL' : 'PASS',
            identity,
            failure,
            providers: processes.map(p => p.record),
            synthetic_authority: true,
            workspace_qualified: false
          },
          null, 2));
}
