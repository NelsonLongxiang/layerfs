// Ordinary native Windows Git on an isolated WinFsp mount, then LayerFS Commit/rebind.
// node tools/winfsp-git-test.mjs <host> <WinFsp-dll> <Rust-dll> <checker> <git.exe> <fresh-output>
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, openSync, closeSync} from 'node:fs';
import {join, resolve, relative} from 'node:path';
assert.equal(process.platform, 'win32');
assert.equal(process.argv.length, 8);
const [host, dll, bridge, checker, git, out] = process.argv.slice(2).map(p => resolve(p));
const coordinatedClose = process.env.LAYERFS_NATIVE_COORDINATED_CLOSE === '1';
assert.ok(!existsSync(out), 'fresh output required');
mkdirSync(out, {recursive: true});
const sha = b => createHash('sha256').update(b).digest('hex');
const paths = {
  host,
  winfsp: dll,
  bridge,
  checker,
  git
};
const identity =
    Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, sha(readFileSync(p))]));
const catalog = Buffer.from('ordinary-git-native-test-v1'), cursor = Buffer.alloc(32, 93),
      branch = Buffer.concat([Buffer.from([0x11]), Buffer.alloc(16, 43)]);
function frame() {
  const n = Buffer.alloc(2);
  n.writeUInt16LE(catalog.length);
  return Buffer.concat([Buffer.from('LFSBND01'), n, catalog, cursor, branch, randomBytes(32)]);
}
const env = {...process.env};
for (const k of Object.keys(env))
  if (k.startsWith('GIT_')) delete env[k];
const home = join(out, 'git-home'), template = join(out, 'empty-template');
mkdirSync(home);
mkdirSync(template);
const config = join(home, 'empty-config');
writeFileSync(config, '', {flag: 'wx'});
Object.assign(env, {
  HOME: home,
  XDG_CONFIG_HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_SYSTEM: config,
  GIT_CONFIG_GLOBAL: config,
  GIT_TEMPLATE_DIR: template,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Native Test',
  GIT_AUTHOR_EMAIL: 'native-test@example.invalid',
  GIT_COMMITTER_NAME: 'Native Test',
  GIT_COMMITTER_EMAIL: 'native-test@example.invalid',
  GIT_AUTHOR_DATE: '2026-11-02T00:00:00+08:00',
  GIT_COMMITTER_DATE: '2026-11-02T00:00:00+08:00'
});
let count = 0;
const commands = [];
function run(exe, args, options = {}) {
  const started = new Date().toISOString();
  const r = spawnSync(
      exe, args, {env, encoding: 'utf8', timeout: 12000, maxBuffer: 4 * 1024 * 1024, ...options});
  const receipt = {
    exe,
    args,
    cwd: options.cwd ?? null,
    started,
    finished: new Date().toISOString(),
    exit: r.status,
    signal: r.signal,
    error: r.error?.message ?? null,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? ''
  };
  const file = String(++count).padStart(2, '0') + '.json';
  writeFileSync(join(out, file), JSON.stringify(receipt, null, 2));
  commands.push({file, exe, args, exit: r.status});
  assert.ifError(r.error);
  assert.equal(r.signal, null);
  assert.equal(r.status, 0, receipt.stderr + receipt.stdout);
  return receipt.stdout;
}
function gitRun(root, ...args) {
  return run(git, ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-C', root, ...args]);
}
const root = join(out, 'fixture');
run(checker, ['binding-setup', root],
    {input: frame(), env: {...env, LAYERFS_PROJFS_PROBE_CHILD_ROOT: root}, timeout: 45000});
const store = join(root, 'store.sqlite'), providers = [];
let failure = null;
const checkpoints = {
  git_created: false,
  first_layerfs_commit: false,
  remount_bytes_exact: false,
  git_history_verified: false,
  second_layerfs_commit: false,
  normal_close_complete: false
};
const timer = setTimeout(() => {
  failure = 'native Git harness exceeded 85 seconds';
  for (const p of providers)
    if (p.child.exitCode === null && !p.child.killed) p.child.kill();
}, 85000);
function launch(name) {
  const local = join(out, name);
  mkdirSync(local);
  const mount = join(local, 'mount'), control = join(local, 'control');
  const args = [dll, mount, control, bridge, '--bind-stdin', store];
  const record = {
    name,
    args,
    started: new Date().toISOString(),
    stdout: '',
    stderr: '',
    exit: null,
    error: null
  };
  // Git runs synchronously below. Pipe consumers on this event loop would stall
  // native callbacks once verbose provider output fills the OS pipe buffer.
  const stdoutPath = join(local, 'provider-stdout.log'),
        stderrPath = join(local, 'provider-stderr.log');
  const stdoutFd = openSync(stdoutPath, 'wx'), stderrFd = openSync(stderrPath, 'wx');
  let child;
  try {
    child = spawn(host, args, {stdio: ['pipe', stdoutFd, stderrFd]});
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  const collect = () => {
    record.stdout = readFileSync(stdoutPath, 'utf8');
    record.stderr = readFileSync(stderrPath, 'utf8');
  };
  record.stdout_path = stdoutPath;
  record.stderr_path = stderrPath;
  child.stdin.on('error', e => record.error = e.message);
  child.stdin.end(frame());
  const ended = new Promise(resolve => {
    child.once('error', e => {
      record.error = e.message;
      record.finished = new Date().toISOString();
      collect();
      resolve(record);
    });
    child.once('exit', (code, signal) => {
      record.exit = {code, signal};
      record.finished = new Date().toISOString();
      collect();
      resolve(record);
    });
  });
  const p = {mount, control, child, record, ended};
  providers.push(p);
  return p;
}
async function phase(p, name) {
  const deadline = Date.now() + 10000;
  while (!existsSync(join(p.control, name))) {
    assert.equal(p.record.exit, null, p.record.stdout + p.record.stderr);
    assert.equal(p.record.error, null);
    assert.ok(Date.now() < deadline, 'phase ' + name);
    await new Promise(r => setTimeout(r, 5));
  }
}
function mark(p, name) {
  writeFileSync(join(p.control, name), 'request', {flag: 'wx'});
}
async function commit(p, index) {
  mark(p, 'binding-commit-' + index);
  await phase(p, 'binding-committed-' + index);
}
async function close(p) {
  if (coordinatedClose) {
    mark(p, 'stop-coordinate');
  } else {
    mark(p, 'close-inspect');
    await phase(p, 'close-idle');
    mark(p, 'stop');
  }
  const r = await p.ended;
  assert.equal(r.exit?.code, 0, r.stdout + r.stderr);
  assert.equal(r.exit?.signal, null);
  assert.equal(existsSync(p.mount), false);
}
function manifest(root, dir = root) {
  const result = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name), s = statSync(p);
    if (s.isDirectory())
      result.push(...manifest(root, p));
    else {
      assert.ok(s.isFile());
      result.push({
        path: relative(root, p).replaceAll('\\', '/'),
        bytes: s.size,
        sha256: sha(readFileSync(p))
      });
    }
  }
  return result;
}
try {
  const a = launch('first');
  await phase(a, 'ready');
  const repo = join(a.mount, 'repo');
  mkdirSync(repo);
  const version = run(git, ['--version']);
  gitRun(repo, 'init', '--initial-branch=main');
  writeFileSync(join(repo, '.gitignore'), 'ignored/\n');
  mkdirSync(join(repo, 'ignored'));
  writeFileSync(join(repo, 'ignored', 'cache.bin'), Buffer.from([0, 1, 2, 255]));
  writeFileSync(join(repo, 'tracked.txt'), 'first native revision\n');
  gitRun(repo, 'add', '.gitignore', 'tracked.txt');
  gitRun(repo, 'commit', '-m', 'native first');
  const first = gitRun(repo, 'rev-parse', 'HEAD').trim();
  assert.match(first, /^[0-9a-f]{40}$/);
  assert.equal(gitRun(repo, 'status', '--porcelain'), '');
  writeFileSync(join(repo, 'tracked.txt'), 'second native revision\n');
  renameSync(join(repo, 'tracked.txt'), join(repo, 'renamed.txt'));
  gitRun(repo, 'add', '-A');
  gitRun(repo, 'commit', '-m', 'native second');
  const second = gitRun(repo, 'rev-parse', 'HEAD').trim();
  assert.notEqual(first, second);
  assert.equal(gitRun(repo, 'rev-parse', 'HEAD^').trim(), first);
  assert.equal(gitRun(repo, 'status', '--porcelain'), '');
  gitRun(repo, 'fsck', '--full');
  assert.equal(gitRun(repo, 'check-ignore', 'ignored/cache.bin').trim(), 'ignored/cache.bin');
  assert.equal(existsSync(join(repo, '.git', 'index.lock')), false);
  assert.equal(existsSync(join(repo, '.git', 'refs', 'heads', 'main.lock')), false);
  const before = manifest(repo);
  assert.ok(before.some(f => f.path === '.git/index'));
  assert.ok(before.some(f => f.path.startsWith('.git/objects/')));
  assert.ok(before.some(f => f.path === 'ignored/cache.bin'));
  writeFileSync(join(out, 'before.json'), JSON.stringify(before, null, 2));
  checkpoints.git_created = true;
  await commit(a, 0);
  checkpoints.first_layerfs_commit = true;
  await close(a);
  const b = launch('second');
  await phase(b, 'ready');
  const rebound = join(b.mount, 'repo');
  const after = manifest(rebound);
  writeFileSync(join(out, 'after.json'), JSON.stringify(after, null, 2));
  assert.deepEqual(after, before, 'all Git/ignored bytes must survive LayerFS Commit and remount');
  checkpoints.remount_bytes_exact = true;
  assert.equal(gitRun(rebound, 'rev-parse', 'HEAD').trim(), second);
  assert.equal(gitRun(rebound, 'rev-parse', 'HEAD^').trim(), first);
  assert.equal(gitRun(rebound, 'status', '--porcelain'), '');
  gitRun(rebound, 'fsck', '--full');
  assert.equal(gitRun(rebound, 'show', 'HEAD:renamed.txt'), 'second native revision\n');
  assert.equal(gitRun(rebound, 'show', first + ':tracked.txt'), 'first native revision\n');
  checkpoints.git_history_verified = true;
  writeFileSync(
      join(out, 'data-checkpoint.json'),
      JSON.stringify(
          {
            version,
            git_commits: [first, second],
            files: before.length,
            checkpoints: {...checkpoints},
            git_commands: commands.length,
            normal_close_qualified: false
          },
          null, 2));
  await commit(b, 0);
  checkpoints.second_layerfs_commit = true;
  await close(b);
  checkpoints.normal_close_complete = true;
  for (const p of providers) {
    assert.match(p.record.stdout, /NORMAL_CLOSE_DONE detach=true overlay_closed=true/);
    assert.match(p.record.stdout, /errors=0/);
    assert.doesNotMatch(p.record.stdout, /STORE_CREATED/);
  }
  for (const [k, p] of Object.entries(paths)) assert.equal(sha(readFileSync(p)), identity[k]);
  writeFileSync(
      join(out, 'observations.json'),
      JSON.stringify(
          {
            version,
            git_commits: [first, second],
            files: before.length,
            ignored_in_layerfs: true,
            remount_bytes_exact: true,
            git_commands: commands.length,
            workspace_qualified: false
          },
          null, 2));
  console.log(
      'PASS ordinary Windows Git init/add/commit/status/fsck; LayerFS Commit preserves objects refs index and ignored content across fresh native mount');
} catch (e) {
  failure = String(e);
  for (const p of providers)
    if (p.child.exitCode === null && !p.child.killed) p.child.kill();
  await Promise.all(providers.map(p => p.ended));
  throw e;
} finally {
  clearTimeout(timer);
  writeFileSync(
      join(out, 'result.json'),
      JSON.stringify(
          {
            status: failure ? 'FAIL' : 'PASS',
            coordinated_close: coordinatedClose,
            identity,
            failure,
            checkpoints,
            commands,
            providers: providers.map(p => p.record),
            workspace_qualified: false
          },
          null, 2));
}
