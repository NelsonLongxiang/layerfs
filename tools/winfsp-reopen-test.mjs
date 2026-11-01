// Ordinary reopen is tested as a candidate, not assumed to be a general close fence.
// node tools/winfsp-reopen-test.mjs <host> <WinFsp-dll> <bridge> <client> <fresh-output>
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, openSync, closeSync, readSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditTrace} from './winfsp-handle-trace.mjs';

export function auditCoordination(raw) {
  assert.equal(raw.status, 'OBSERVED');
  assert.equal(raw.failure, null);
  assert.equal(raw.deadline_expired, false);
  assert.equal(raw.general_close_qualified, false);
  for (const key of ['host', 'winfsp', 'bridge', 'client'])
    assert.match(raw.identity[key], /^[0-9a-f]{64}$/);
  for (const p of [raw.provider, raw.application]) {
    assert.ok(p);
    assert.equal(p.error, null);
    assert.equal(p.exit?.code, 0);
    assert.equal(p.exit?.signal, null);
    const start = Date.parse(p.started), end = Date.parse(p.finished);
    assert.ok(Number.isFinite(start) && end >= start && end - start <= 120000);
  }
  const p = raw.provider.stdout, app = raw.application.stdout;
  const proof = auditTrace(p);
  assert.equal(proof.normal_close, true);
  assert.equal(proof.outstanding.length, 0);
  const trace =
      [
        ...p.matchAll(
            /^NATIVE_HANDLE event=(open|create|cleanup|close) seq=(\d+) tick=(\d+) handle=(\d+) serial=(\d+) flags=([0-9a-f]{8}) name=(.+)$/gm)
      ]
          .map(m => ({
                 event: m[1],
                 seq: Number(m[2]),
                 handle: m[4],
                 serial: m[5],
                 flags: m[6],
                 name: m[7].trim()
               }))
          .sort((a, b) => a.seq - b.seq);
  const source = trace.find(
      t => t.event === 'open' &&
          t.name.split(String.fromCharCode(92)).join('/') === '/nested/data.bin');
  assert.ok(source);
  assert.equal(raw.original_handle, source.handle);
  assert.equal(parseInt(source.flags, 16) & 6, 0, 'source was read only');
  const original = trace.filter(t => t.handle === source.handle);
  assert.deepEqual(original.map(t => t.event), ['open', 'cleanup', 'close']);
  const required = [
    'view-live', 'stop-busy-view-live', 'reopen-view-live-begin', 'reopen-view-live-returned',
    'view-read-after-busy', 'owner-unmapped-and-exited', 'after-unmap-observation',
    'reopen-after-unmap-begin', 'reopen-after-unmap-returned', 'after-post-unmap-reopen'
  ];
  assert.deepEqual(raw.events.map(e => e.name), required);
  let time = -Infinity, seq = 0;
  const events = {};
  for (const e of raw.events) {
    const at = Date.parse(e.at);
    assert.ok(Number.isFinite(at) && at >= time);
    assert.ok(
        Number.isSafeInteger(e.last_trace_seq) && e.last_trace_seq >= seq &&
        e.last_trace_seq <= proof.events);
    events[e.name] = e;
    time = at;
    seq = e.last_trace_seq;
  }
  const close = original[2];
  assert.ok(original[1].seq <= events['view-live'].last_trace_seq);
  assert.ok(
      close.seq > events['reopen-after-unmap-begin'].last_trace_seq,
      'original Close after explicit post-unmap action');
  assert.ok(close.seq <= events['after-post-unmap-reopen'].last_trace_seq);
  assert.ok(
      Date.parse(events['owner-unmapped-and-exited'].at) >= Date.parse(raw.application.finished));
  const afterRelease = Date.parse(events['after-unmap-observation'].at) -
      Date.parse(events['owner-unmapped-and-exited'].at);
  assert.ok(
      afterRelease >= 10000 && afterRelease <= 120000, 'unchanged bounded no-reopen observation');
  function laterOpen(begin, end) {
    const opens = trace.filter(
        t => t.event === 'open' && t.serial === source.serial && t.handle !== source.handle &&
            t.seq > events[begin].last_trace_seq && t.seq <= events[end].last_trace_seq);
    assert.equal(opens.length, 1);
    const life = trace.filter(t => t.handle === opens[0].handle);
    assert.deepEqual(life.map(t => t.event), ['open', 'cleanup', 'close']);
    return life;
  }
  const whileLive = laterOpen('reopen-view-live-begin', 'view-read-after-busy'),
        afterUnmap = laterOpen('reopen-after-unmap-begin', 'after-post-unmap-reopen');
  assert.ok(whileLive[2].seq < close.seq);
  assert.ok(afterUnmap[1].seq < close.seq);
  assert.match(p, /NORMAL_CLOSE_REFUSED request=stop service_kept=true/);
  assert.match(raw.provider.stderr, /OVERLAY_REFUSAL 80000011/);
  assert.ok(
      p.indexOf('NORMAL_CLOSE_REFUSED request=stop') <
      p.indexOf('NATIVE_HANDLE event=open seq=' + whileLive[0].seq + ' '));
  assert.ok(
      p.indexOf('NATIVE_HANDLE event=close seq=' + close.seq + ' ') <
      p.indexOf('NORMAL_CLOSE_PREPARED'));
  assert.match(app, /VIEW_COORDINATION after_busy_and_reopen=true view_readable=true byte=0/);
  assert.match(app, /released_by_owner=true unmapped=true no_flush=true/);
  assert.deepEqual(raw.checkpoints, {
    busy_while_live: true,
    read_after_busy: true,
    view_read_after_reopen: true,
    owner_released: true,
    old_closed_while_view_live: false,
    old_closed_after_unmap: false,
    old_closed_after_reopen: true,
    normal_close: true
  });
  assert.match(
      p,
      /CALLBACKS create=0 open=\d+ read=\d+ write=0 rename=0 cleanup=\d+ close=\d+ delete=0 errors=0/);
  return {
    original_handle: source.handle,
    serial: source.serial,
    original_events: original,
    while_live: whileLive,
    after_unmap: afterUnmap,
    unmapped_observation_ms: afterRelease,
    normal_close: true,
    general_close_qualified: false
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--self-test') {
    const raw = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
    auditCoordination(raw);
    console.log('PASS observed readonly reopen sequence');
    const cases = [
      [
        'early original Close',
        r => r.events.find(e => e.name === 'reopen-after-unmap-begin').last_trace_seq =
            r.events.at(-1).last_trace_seq
      ],
      ['wrong original token', r => r.original_handle = '999'],
      ['invented general guarantee', r => r.general_close_qualified = true],
      [
        'missing view check',
        r => r.application.stdout =
            r.application.stdout.replace('view_readable=true', 'view_readable=false')
      ],
      [
        'absent unmap',
        r => r.application.stdout = r.application.stdout.replace('unmapped=true', 'unmapped=false')
      ],
      [
        'missing reopen',
        r => r.events = r.events.filter(e => e.name !== 'reopen-after-unmap-begin')
      ],
      ['claim Close while view live', r => r.checkpoints.old_closed_while_view_live = true],
      ['timeout as success', r => r.deadline_expired = true],
      ['cancelled provider', r => r.provider.exit = {code: null, signal: 'SIGTERM'}],
    ];
    for (const [name, mutate] of cases) {
      const r = structuredClone(raw);
      mutate(r);
      assert.throws(() => auditCoordination(r), name);
      console.log('PASS reject ' + name);
    }
    process.exit(0);
  }
  assert.equal(process.platform, 'win32');
  assert.equal(process.argv.length, 7);
  const [host, dll, bridge, client, out] = process.argv.slice(2).map(p => resolve(p));
  assert.ok(!existsSync(out));
  mkdirSync(out, {recursive: true});
  const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
  const identity = {host: sha(host), winfsp: sha(dll), bridge: sha(bridge), client: sha(client)};
  const catalog = Buffer.from('readonly-reopen-control-v1'), cursor = Buffer.alloc(32, 96),
        branch = Buffer.concat([Buffer.from([0x11]), Buffer.alloc(16, 46)]);
  const n = Buffer.alloc(2);
  n.writeUInt16LE(catalog.length);
  const frame = () =>
      Buffer.concat([Buffer.from('LFSBND01'), n, catalog, cursor, branch, randomBytes(32)]);
  const guardEnv = {...process.env};
  delete guardEnv.LAYERFS_PROJFS_PROBE_CHILD_ROOT;
  const guard = spawnSync(
      client, ['mapping-coordination', join(out, 'absent-guard')],
      {encoding: 'utf8', timeout: 5000, env: guardEnv});
  writeFileSync(
      join(out, 'guard.json'),
      JSON.stringify(
          {
            exit: guard.status,
            signal: guard.signal,
            error: guard.error?.message ?? null,
            stdout: guard.stdout,
            stderr: guard.stderr
          },
          null, 2));
  assert.ifError(guard.error);
  assert.equal(guard.status, 1);
  assert.equal(guard.signal, null);
  assert.match(guard.stderr, /requires diagnostic parent/);
  const fixture = join(out, 'fixture');
  const setup = spawnSync(client, ['binding-setup', fixture], {
    encoding: 'utf8',
    input: frame(),
    timeout: 30000,
    env: {...process.env, LAYERFS_PROJFS_PROBE_CHILD_ROOT: fixture}
  });
  writeFileSync(
      join(out, 'setup.json'),
      JSON.stringify(
          {
            exit: setup.status,
            stdout: setup.stdout,
            stderr: setup.stderr,
            error: setup.error?.message ?? null
          },
          null, 2));
  assert.ifError(setup.error);
  assert.equal(setup.status, 0);
  const root = join(out, 'case');
  mkdirSync(root);
  const mount = join(root, 'mount'), control = join(root, 'control'),
        path = join(mount, 'nested', 'data.bin');
  function launch(label, exe, args, options = {}) {
    const stdout = join(root, label + '-stdout.log'), stderr = join(root, label + '-stderr.log');
    const of = openSync(stdout, 'wx'), ef = openSync(stderr, 'wx');
    const record = {
      label,
      exe,
      args,
      started: new Date().toISOString(),
      finished: null,
      exit: null,
      error: null,
      stdout_path: stdout,
      stderr_path: stderr
    };
    let child;
    try {
      child = spawn(exe, args, {...options, stdio: ['pipe', of, ef]});
    } finally {
      closeSync(of);
      closeSync(ef);
    }
    child.stdin.on('error', e => record.error = e.message);
    const ended = new Promise(resolve => {
      child.once('error', e => {
        record.error = e.message;
        record.finished = new Date().toISOString();
        resolve();
      });
      child.once('exit', (code, signal) => {
        record.exit = {code, signal};
        record.finished = new Date().toISOString();
        resolve();
      });
    });
    return {
      child,
      record,
      ended,
      text: () => readFileSync(stdout, 'utf8'),
      errors: () => readFileSync(stderr, 'utf8')
    };
  }
  const provider = launch(
      'provider', host,
      [dll, mount, control, bridge, '--bind-stdin', join(fixture, 'store.sqlite')],
      {env: {...process.env, LAYERFS_NATIVE_TRACE_HANDLES: '1'}});
  provider.child.stdin.end(frame());
  let app = null, failure = null, deadlineExpired = false, originalHandle = null;
  const events = [];
  const checkpoints = {
    busy_while_live: false,
    read_after_busy: false,
    view_read_after_reopen: false,
    owner_released: false,
    old_closed_while_view_live: false,
    old_closed_after_unmap: false,
    old_closed_after_reopen: false,
    normal_close: false
  };
  const timer = setTimeout(() => {
    deadlineExpired = true;
    app?.child.kill();
    provider.child.kill();
  }, 35000);
  async function phase(name, ms = 5000) {
    const until = Date.now() + ms;
    while (!existsSync(join(control, name))) {
      assert.equal(provider.record.exit, null, provider.text() + provider.errors());
      assert.equal(provider.record.error, null);
      if (app) assert.equal(app.record.error, null);
      if (Date.now() >= until) return false;
      await new Promise(r => setTimeout(r, 5));
    }
    return true;
  }
  function mark(name) {
    writeFileSync(join(control, name), 'request', {flag: 'wx'});
  }
  function event(name) {
    events.push({
      name,
      at: new Date().toISOString(),
      last_trace_seq: Math.max(
          0, ...[...provider.text().matchAll(/NATIVE_HANDLE .*seq=(\d+)/g)].map(m => Number(m[1])))
    });
  }
  function ordinaryRead(label) {
    event(label + '-begin');
    const fd = openSync(path, 'r');
    try {
      const b = Buffer.alloc(1);
      assert.equal(readSync(fd, b, 0, 1, 0), 1);
      assert.equal(b[0], 0);
    } finally {
      closeSync(fd);
    }
    event(label + '-returned');
  }
  try {
    assert.ok(await phase('ready'));
    app = launch(
        'application', client, ['mapping-coordination', root],
        {env: {...process.env, LAYERFS_PROJFS_PROBE_CHILD_ROOT: root}});
    app.child.stdin.end();
    assert.ok(await phase('view-live'));
    event('view-live');
    const open = [
      ...provider.text().matchAll(
          /^NATIVE_HANDLE event=open seq=(\d+).*handle=(\d+) serial=(\d+) flags=([0-9a-f]+) name=(.+)$/gm)
    ].find(m => m[5].trim().split(String.fromCharCode(92)).join('/') === '/nested/data.bin');
    assert.ok(open, 'mapping file open token');
    const original = open[2];
    originalHandle = original;
    const closed = () =>
        new RegExp('NATIVE_HANDLE event=close .* handle=' + original + ' ').test(provider.text());
    mark('close-inspect');
    mark('stop');
    assert.ok(await phase('stop-refused'));
    checkpoints.busy_while_live = true;
    event('stop-busy-view-live');
    assert.doesNotMatch(provider.text(), /NORMAL_CLOSE_PREPARED|NORMAL_CLOSE_STOP_BEGIN/);
    ordinaryRead('reopen-view-live');
    checkpoints.read_after_busy = true;
    mark('check-view');
    assert.ok(await phase('view-checked'));
    checkpoints.view_read_after_reopen = true;
    checkpoints.old_closed_while_view_live = closed();
    assert.equal(
        checkpoints.old_closed_while_view_live, false,
        'must retain mapping source while view live');
    event('view-read-after-busy');
    mark('release-view');
    assert.ok(await phase('view-released'));
    await app.ended;
    assert.equal(app.record.exit?.code, 0, app.errors());
    assert.equal(app.record.exit?.signal, null);
    checkpoints.owner_released = true;
    event('owner-unmapped-and-exited');
    const idleWithoutReopen = await phase('close-idle', 10000);
    checkpoints.old_closed_after_unmap = closed();
    event('after-unmap-observation');
    if (!idleWithoutReopen) {
      ordinaryRead('reopen-after-unmap');
      const idleAfterReopen = await phase('close-idle', 10000);
      checkpoints.old_closed_after_reopen = closed();
      event('after-post-unmap-reopen');
      if (!idleAfterReopen) {
        assert.ok(!closed());
        provider.child.kill();
        await provider.ended;
      }
    }
    if (provider.record.exit === null) {
      assert.ok(closed(), 'actual original Close must arrive before final stop');
      mark('stop-after-release');
      await provider.ended;
      assert.equal(provider.record.exit?.code, 0, provider.text() + provider.errors());
      assert.equal(provider.record.exit?.signal, null);
      assert.equal(existsSync(mount), false);
      checkpoints.normal_close = true;
    }
    const proof = auditTrace(provider.text());
    assert.equal(proof.normal_close, checkpoints.normal_close);
    assert.match(app.text(), /after_busy_and_reopen=true view_readable=true/);
    assert.match(app.text(), /released_by_owner=true unmapped=true no_flush=true/);
    const receipt = {
      status: 'OBSERVED',
      identity,
      failure,
      deadline_expired: deadlineExpired,
      original_handle: original,
      checkpoints,
      events,
      provider: {...provider.record, stdout: provider.text(), stderr: provider.errors()},
      application: {...app.record, stdout: app.text(), stderr: app.errors()},
      general_close_qualified: false
    };
    const coordination = checkpoints.old_closed_after_reopen && checkpoints.normal_close ?
        auditCoordination(receipt) :
        null;
    writeFileSync(
        join(out, 'audit.json'),
        JSON.stringify(
            {original_handle: original, events, checkpoints, proof, coordination}, null, 2));
    for (const [key, p] of Object.entries({host, winfsp: dll, bridge, client}))
      assert.equal(sha(p), identity[key]);
    console.log(JSON.stringify({original_handle: original, checkpoints, events}, null, 2));
  } catch (e) {
    failure = String(e);
    for (const p of [app, provider])
      if (p && p.child.exitCode === null && !p.child.killed) p.child.kill();
    await Promise.all([app?.ended, provider.ended]);
    throw e;
  } finally {
    clearTimeout(timer);
    for (const p of [app, provider])
      if (p) {
        p.record.stdout = p.text();
        p.record.stderr = p.errors();
      }
    writeFileSync(
        join(out, 'result.json'),
        JSON.stringify(
            {
              status: failure ? 'FAIL' : 'OBSERVED',
              identity,
              failure,
              deadline_expired: deadlineExpired,
              original_handle: originalHandle,
              checkpoints,
              events,
              provider: provider.record,
              application: app?.record ?? null,
              general_close_qualified: false
            },
            null, 2));
  }
}
