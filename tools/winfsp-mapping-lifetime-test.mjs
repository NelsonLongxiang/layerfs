// A read-only mapping lifetime comparison, not a cache-drain implementation.
// node tools/winfsp-mapping-lifetime-test.mjs <host> <WinFsp-dll> <bridge> <client> <fresh-output>
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {auditReceipt} from './winfsp-handle-trace.mjs';
assert.equal(process.platform, 'win32');
assert.equal(process.argv.length, 7);
const [host, dll, bridge, client, out] = process.argv.slice(2).map(p => resolve(p));
assert.ok(!existsSync(out));
mkdirSync(out, {recursive: true});
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const identity = {
  host: sha(host),
  winfsp: sha(dll),
  bridge: sha(bridge),
  client: sha(client)
};
const catalog = Buffer.from('mapping-lifetime-isolated-v1'), cursor = Buffer.alloc(32, 95),
      branch = Buffer.concat([Buffer.from([0x11]), Buffer.alloc(16, 45)]);
function frame() {
  const n = Buffer.alloc(2);
  n.writeUInt16LE(catalog.length);
  return Buffer.concat([Buffer.from('LFSBND01'), n, catalog, cursor, branch, randomBytes(32)]);
}
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
const guardPath = join(out, 'absent-input');
const guard = spawnSync(
    client, ['mapping-lifetime', guardPath, 'file-first'], {encoding: 'utf8', timeout: 5000});
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
const invalid = spawnSync(client, ['mapping-lifetime', guardPath, 'invalid'], {
  encoding: 'utf8',
  timeout: 5000,
  env: {...process.env, LAYERFS_PROJFS_PROBE_CHILD_ROOT: guardPath}
});
writeFileSync(
    join(out, 'invalid-mode.json'),
    JSON.stringify(
        {
          exit: invalid.status,
          signal: invalid.signal,
          error: invalid.error?.message ?? null,
          stdout: invalid.stdout,
          stderr: invalid.stderr
        },
        null, 2));
assert.ifError(invalid.error);
assert.equal(invalid.status, 1);
assert.equal(invalid.signal, null);
assert.match(invalid.stderr, /unknown lifetime order/);
const cases = [];
for (const mode of ['read', 'view-first', 'file-first']) {
  const root = join(out, mode);
  mkdirSync(root);
  const mount = join(root, 'mount'), control = join(root, 'control');
  const log = join(root, 'stdout.log'), err = join(root, 'stderr.log');
  const of = openSync(log, 'wx'), ef = openSync(err, 'wx');
  const record = {
    mode,
    started: new Date().toISOString(),
    exit: null,
    error: null,
    normal_close: false,
    busy: false,
    deadline_expired: false,
    failure: null
  };
  const child = spawn(
      host, [dll, mount, control, bridge, '--bind-stdin', join(fixture, 'store.sqlite')],
      {env: {...process.env, LAYERFS_NATIVE_TRACE_HANDLES: '1'}, stdio: ['pipe', of, ef]});
  closeSync(of);
  closeSync(ef);
  child.stdin.on('error', e => {
    record.error = e.message;
  });
  child.stdin.end(frame());
  const ended = new Promise(resolve => {
    child.once('error', e => {
      record.error = e.message;
      resolve();
    });
    child.once('exit', (code, signal) => {
      record.exit = {code, signal};
      record.finished = new Date().toISOString();
      resolve();
    });
  });
  const deadline = setTimeout(() => {
    record.deadline_expired = true;
    child.kill();
  }, 20000);
  async function ready(name, ms) {
    const until = Date.now() + ms;
    while (!existsSync(join(control, name))) {
      assert.equal(record.exit, null, readFileSync(log, 'utf8') + readFileSync(err, 'utf8'));
      assert.equal(record.error, null);
      if (Date.now() >= until) return false;
      await new Promise(r => setTimeout(r, 5));
    }
    return true;
  }
  try {
    assert.ok(await ready('ready', 5000));
    const path = join(mount, 'nested', 'data.bin');
    const r = spawnSync(client, ['mapping-lifetime', path, mode], {
      encoding: 'utf8',
      timeout: 5000,
      env: {...process.env, LAYERFS_PROJFS_PROBE_CHILD_ROOT: path}
    });
    record.application = {
      exit: r.status,
      signal: r.signal,
      error: r.error?.message ?? null,
      stdout: r.stdout,
      stderr: r.stderr
    };
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.signal, null);
    writeFileSync(join(control, 'close-inspect'), 'inspect', {flag: 'wx'});
    const idle = await ready('close-idle', 10000);
    writeFileSync(join(control, 'stop'), 'stop', {flag: 'wx'});
    if (idle) {
      await ended;
      assert.equal(record.exit?.code, 0);
      assert.equal(record.exit?.signal, null);
      record.normal_close = true;
      assert.equal(existsSync(mount), false);
    } else {
      assert.ok(await ready('stop-refused', 2000));
      record.busy = true;
      child.kill();
      await ended;
    }
  } catch (e) {
    record.failure = String(e);
    throw e;
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && !child.killed) child.kill();
    await ended;
    record.stdout = readFileSync(log, 'utf8');
    record.stderr = readFileSync(err, 'utf8');
    writeFileSync(join(root, 'result.json'), JSON.stringify(record, null, 2));
    cases.push(record);
  }
}
for (const [k, p] of Object.entries({host, winfsp: dll, bridge, client}))
  assert.equal(sha(p), identity[k]);
const result = {
  identity,
  cases,
  qualification: 'lifetime observation only; no guessed release or cache fence'
};
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
writeFileSync(join(out, 'audit.json'), JSON.stringify(auditReceipt(result), null, 2));
console.log(JSON.stringify(
    cases.map(c => ({
                mode: c.mode,
                normal_close: c.normal_close,
                busy: c.busy,
                application: c.application,
                states: c.stdout.split(/\r?\n/).filter(s => s.startsWith('NORMAL_CLOSE_OBSERVED'))
              })),
    null, 2));
