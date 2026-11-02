// Explicit native close coordination, not caller-issued reopen/flush.
// node tools/winfsp-coordinate-test.mjs <host> <WinFsp-dll> <Rust-dll> <client> <fresh-output>
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, openSync, closeSync, readSync, readFileSync, writeFileSync, renameSync, unlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditTrace} from './winfsp-handle-trace.mjs';

export function analyze(raw) {
  assert.equal(raw.status, 'PASS');
  assert.equal(raw.normal_close, true);
  assert.equal(raw.failure, null);
  assert.equal(raw.deadline_expired, false);
  assert.equal(raw.general_section_inventory, false);
  assert.equal(raw.workspace_qualified, false);
  assert.ok(['plain', 'rename', 'delete-refusal'].includes(raw.scenario));
  for (const p of [raw.provider, raw.application]) {
    assert.equal(p.error, null);
    assert.deepEqual(p.exit, {code: 0, signal: null});
    const a = Date.parse(p.started), b = Date.parse(p.finished);
    assert.ok(Number.isFinite(a) && b >= a && b - a <= 120000);
  }
  const stdout = raw.provider.stdout, proof = auditTrace(stdout);
  assert.equal(proof.normal_close, true);
  const trace =
      [
        ...stdout.matchAll(
            /^NATIVE_HANDLE event=(open|create|cleanup|close) seq=(\d+) tick=(\d+) handle=(\d+) serial=(\d+) flags=([0-9a-f]{8}) name=(.*)$/gm)
      ]
          .map(m => ({
                 event: m[1],
                 seq: +m[2],
                 tick: +m[3],
                 handle: m[4],
                 serial: m[5],
                 flags: m[6],
                 name: m[7].trim()
               }))
          .sort((a, b) => a.seq - b.seq);
  const old = trace.filter(t => t.handle === raw.original_handle);
  assert.deepEqual(old.map(t => t.event), ['open', 'cleanup', 'close']);
  assert.equal(
      parseInt(old[0].flags, 16) & 0xd0116, 0, 'source must lack write/delete/control access');
  const begin = [...stdout.matchAll(/^CLOSE_COORDINATE_BEGIN token=(\d+) status=([0-9a-f]+)$/gm)];
  assert.equal(begin.length, 2);
  assert.ok(begin.every(m => m[2] === '00000000'));
  assert.ok(+begin[1][1] > +begin[0][1]);
  const visits = [
    ...stdout.matchAll(
        /^CLOSE_COORDINATE_VISIT token=(\d+) original=(\d+) serial=(\d+) identity=(\w+) read=(\w+) closed=(\w+)$/gm)
  ];
  assert.equal(visits.length, 2);
  for (const [i, v] of visits.entries()) {
    assert.equal(v[1], begin[i][1]);
    assert.equal(v[2], raw.original_handle);
    assert.equal(v[3], old[0].serial);
    assert.deepEqual(v.slice(4), ['true', 'true', 'true']);
  }
  assert.match(
      stdout,
      new RegExp(
          'CLOSE_COORDINATE_ABORT token=' + begin[0][1] +
          ' status=80000011 admission_restored=true'));
  assert.match(
      stdout,
      new RegExp(
          'CLOSE_COORDINATE_END token=' + begin[1][1] +
          ' status=00000000 real_close_receipts=true'));
  assert.match(stdout, /NORMAL_CLOSE_REFUSED request=coordinate service_kept=true/);
  const expected = [
    'view-live',
    ...(raw.scenario === 'rename'             ? ['renamed-original-and-replaced-path'] :
            raw.scenario === 'delete-refusal' ? ['mapped-delete-refused'] :
                                                []),
    'coordinated-busy', 'read-after-busy', 'view-read-after-busy', 'owner-unmapped',
    'normal-detached'
  ];
  assert.deepEqual(raw.stages.map(s => s.name), expected);
  let time = -Infinity, seq = 0;
  for (const s of raw.stages) {
    const at = Date.parse(s.at);
    assert.ok(Number.isFinite(at) && at >= time);
    assert.ok(
        Number.isSafeInteger(s.last_trace_seq) && s.last_trace_seq >= seq &&
        s.last_trace_seq <= proof.events);
    time = at;
    seq = s.last_trace_seq;
  }
  const event = name => raw.stages.find(s => s.name === name);
  assert.ok(old[1].seq <= event('view-live').last_trace_seq);
  assert.ok(old[2].seq > event('owner-unmapped').last_trace_seq, 'no Close before owner release');
  assert.ok(Date.parse(event('owner-unmapped').at) >= Date.parse(raw.application.finished));
  assert.ok(stdout.indexOf('CLOSE_COORDINATE_ABORT ') < stdout.indexOf('NORMAL_CLOSE_PREPARED '));
  assert.ok(
      stdout.indexOf('NATIVE_HANDLE event=close seq=' + old[2].seq + ' ') <
      stdout.indexOf('NORMAL_CLOSE_PREPARED '));
  const candidate = trace.filter(
      t => t.event === 'open' && t.serial === old[0].serial &&
          t.seq > event('owner-unmapped').last_trace_seq);
  assert.equal(candidate.length, 1);
  assert.equal(candidate[0].name, raw.scenario === 'rename' ? '\\moved\\data.bin' : old[0].name);
  const life = trace.filter(t => t.handle === candidate[0].handle);
  assert.deepEqual(life.map(t => t.event), ['open', 'cleanup', 'close']);
  assert.ok(life[1].seq < old[2].seq);
  assert.match(raw.application.stdout, /after_busy_and_reopen=true view_readable=true byte=0/);
  assert.match(raw.application.stdout, /released_by_owner=true unmapped=true no_flush=true/);
  return {
    scenario: raw.scenario,
    original_handle: raw.original_handle,
    original_serial: old[0].serial,
    coordination_attempts: 2,
    verified_visits: visits.length,
    actual_original_close: old[2].seq,
    refusal_read_usable: true,
    normal_close: true,
    events: proof.events
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--self-test') {
    const raw = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
    analyze(raw);
    console.log('PASS exact coordinated close trace');
    for (const [name, mutate] of [
             [
               'identity mismatch',
               r => r.provider.stdout = r.provider.stdout.replace('identity=true', 'identity=false')
             ],
             ['original token mismatch', r => r.original_handle = '9999'],
             [
               'lost Busy refusal',
               r => r.provider.stdout = r.provider.stdout.replace(
                   'request=coordinate service_kept=true', 'request=unproved')
             ],
             [
               'no admission restoration',
               r => r.provider.stdout =
                   r.provider.stdout.replace('admission_restored=true', 'admission_restored=false')
             ],
             [
               'view usability unproved',
               r => r.application.stdout =
                   r.application.stdout.replace('view_readable=true', 'view_readable=false')
             ],
             [
               'owner unmap unproved',
               r => r.application.stdout =
                   r.application.stdout.replace('unmapped=true', 'unmapped=false')
             ],
             [
               'Close before owner release',
               r => r.stages.find(s => s.name === 'owner-unmapped').last_trace_seq =
                   r.stages.at(-1).last_trace_seq
             ],
             ['invented kernel inventory', r => r.general_section_inventory = true],
             ['provider cancellation', r => r.provider.exit = {code: null, signal: 'SIGTERM'}],
             ['deadline promoted', r => r.deadline_expired = true],
    ]) {
      const r = structuredClone(raw);
      mutate(r);
      assert.throws(() => analyze(r), name);
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
  const catalog = Buffer.from('close-coordination-synthetic-v1'), cursor = Buffer.alloc(32, 97),
        branch = Buffer.concat([Buffer.from([0x11]), Buffer.alloc(16, 47)]), n = Buffer.alloc(2);
  n.writeUInt16LE(catalog.length);
  const frame = () =>
      Buffer.concat([Buffer.from('LFSBND01'), n, catalog, cursor, branch, randomBytes(32)]);
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
            signal: setup.signal,
            error: setup.error?.message ?? null,
            stdout: setup.stdout,
            stderr: setup.stderr
          },
          null, 2));
  assert.ifError(setup.error);
  assert.equal(setup.status, 0);
  assert.equal(setup.signal, null);
  const scenario = process.env.LAYERFS_NATIVE_COORDINATION_CASE ?? 'plain';
  assert.ok(['plain', 'rename', 'delete-refusal'].includes(scenario));
  const root = join(out, 'case');
  mkdirSync(root);
  const mount = join(root, 'mount'), control = join(root, 'control');
  const originalPath = join(mount, 'nested', 'data.bin'),
        readPath = scenario === 'rename' ? join(mount, 'moved', 'data.bin') : originalPath;
  const expectedRead = 0;
  function launch(name, exe, args, env) {
    const stdout = join(root, name + '-stdout.log'), stderr = join(root, name + '-stderr.log'),
          a = openSync(stdout, 'wx'), b = openSync(stderr, 'wx');
    let child;
    try {
      child = spawn(exe, args, {env, stdio: ['pipe', a, b]});
    } finally {
      closeSync(a);
      closeSync(b);
    }
    const record = {name, exe, args, started: new Date().toISOString(), exit: null, error: null};
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
      {...process.env, LAYERFS_NATIVE_TRACE_HANDLES: '1'});
  provider.child.stdin.end(frame());
  let app = null, failure = null, deadline = false, original = null;
  const stages = [];
  const timer = setTimeout(() => {
    deadline = true;
    app?.child.kill();
    provider.child.kill();
  }, 35000);
  async function phase(name, ms = 5000) {
    const end = Date.now() + ms;
    while (!existsSync(join(control, name))) {
      assert.equal(provider.record.exit, null, provider.text() + provider.errors());
      assert.equal(provider.record.error, null);
      if (app) assert.equal(app.record.error, null);
      assert.ok(Date.now() < end, 'phase ' + name);
      await new Promise(r => setTimeout(r, 5));
    }
  }
  function mark(name) {
    writeFileSync(join(control, name), 'explicit-request', {flag: 'wx'});
  }
  function stage(name) {
    stages.push({
      name,
      at: new Date().toISOString(),
      last_trace_seq: Math.max(
          0, ...[...provider.text().matchAll(/NATIVE_HANDLE .*seq=(\d+)/g)].map(m => Number(m[1])))
    });
  }
  try {
    await phase('ready');
    app = launch(
        'owner', client, ['mapping-coordination', root],
        {...process.env, LAYERFS_PROJFS_PROBE_CHILD_ROOT: root});
    app.child.stdin.end();
    await phase('view-live');
    const open = [
      ...provider.text().matchAll(
          /^NATIVE_HANDLE event=open seq=\d+ .*handle=(\d+) serial=(\d+) flags=([0-9a-f]+) name=(.+)$/gm)
    ].find(m => m[4].trim().replaceAll('\\', '/') === '/nested/data.bin');
    assert.ok(open);
    original = open[1];
    stage('view-live');
    if (scenario === 'rename') {
      renameSync(join(mount, 'nested'), join(mount, 'moved'));
      mkdirSync(join(mount, 'nested'));
      writeFileSync(originalPath, 'NEW-PATH-CONTENT');
      stage('renamed-original-and-replaced-path');
    }
    if (scenario === 'delete-refusal') {
      assert.throws(() => unlinkSync(originalPath), e => e.code === 'EPERM');
      assert.equal(existsSync(originalPath), true);
      stage('mapped-delete-refused');
    }
    mark('close-inspect');
    mark('stop-coordinate');
    await phase('coordinate-refused', 12000);
    stage('coordinated-busy');
    assert.match(
        provider.text(), /CLOSE_COORDINATE_ABORT .*status=80000011 admission_restored=true/);
    assert.doesNotMatch(
        provider.text(), new RegExp('NATIVE_HANDLE event=close .* handle=' + original + ' '));
    assert.doesNotMatch(provider.text(), /NORMAL_CLOSE_PREPARED|NORMAL_CLOSE_STOP_BEGIN/);
    const fd = openSync(readPath, 'r');
    try {
      const data = Buffer.alloc(1);
      assert.equal(readSync(fd, data, 0, 1, 0), 1);
      assert.equal(data[0], expectedRead);
    } finally {
      closeSync(fd);
    }
    stage('read-after-busy');
    mark('check-view');
    await phase('view-checked');
    assert.match(app.text(), /after_busy_and_reopen=true view_readable=true byte=0/);
    stage('view-read-after-busy');
    mark('release-view');
    await phase('view-released');
    await app.ended;
    assert.equal(app.record.exit?.code, 0, app.errors());
    assert.equal(app.record.exit?.signal, null);
    stage('owner-unmapped');
    mark('stop-coordinate-after-release');
    {
      await provider.ended;
      assert.equal(provider.record.exit?.code, 0, provider.text() + provider.errors());
      assert.equal(provider.record.exit?.signal, null);
      assert.equal(existsSync(mount), false);
      const proof = auditTrace(provider.text());
      assert.equal(proof.normal_close, true);
      assert.equal(proof.outstanding.length, 0);
      assert.match(
          provider.text(),
          new RegExp(
              'CLOSE_COORDINATE_VISIT .*original=' + original +
              ' .*identity=true read=true closed=true'));
      assert.match(
          provider.text(), /CLOSE_COORDINATE_END .*status=00000000 real_close_receipts=true/);
      if (scenario === 'plain')
        assert.match(provider.text(), /CALLBACKS create=0 .*write=0 rename=0 .*delete=0 errors=0/);
      else
        assert.match(provider.text(), /CALLBACKS .*errors=0/);
      stage('normal-detached');
    }
    for (const [key, p] of Object.entries({host, winfsp: dll, bridge, client}))
      assert.equal(sha(p), identity[key]);
    const checked = analyze({
      status: 'PASS',
      scenario,
      normal_close: true,
      identity,
      failure,
      deadline_expired: deadline,
      original_handle: original,
      stages,
      provider: {...provider.record, stdout: provider.text(), stderr: provider.errors()},
      application: {...app.record, stdout: app.text(), stderr: app.errors()},
      general_section_inventory: false,
      workspace_qualified: false
    });
    writeFileSync(join(out, 'audit.json'), JSON.stringify(checked, null, 2));
    console.log(
        'PASS explicit coordinator: live readonly view Busy and readable; owner release then new request visits verified identity, receives actual Close and detaches');
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
              status: failure ? 'FAIL' : 'PASS',
              scenario,
              normal_close: !failure,
              identity,
              failure,
              deadline_expired: deadline,
              original_handle: original,
              stages,
              provider: provider.record,
              application: app?.record ?? null,
              general_section_inventory: false,
              workspace_qualified: false
            },
            null, 2));
  }
}
