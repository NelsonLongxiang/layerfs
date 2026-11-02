// Corrupt copies, never retained receipts or the imported source snapshot.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {facts, audit, hash} from './lifecycle.mjs';
const path = process.argv[2];
assert.ok(path);
const before = hash(readFileSync(path));
const db = new DatabaseSync(path, {readOnly: true});
const raw = Object.fromEntries(db.prepare('SELECT name,body FROM lifecycle_artifacts')
                                   .all()
                                   .map(r => [r.name, JSON.parse(r.body)]));
assert.equal(audit(db).git.close_complete, 0);
console.log('PASS recomputed retained facts with Git close FAIL');
const cases = [
  ['missing raw command', a => delete a.command_20],
  ['Git overall promoted', a => a.git.status = 'PASS'],
  [
    'Git termination promoted', a => a.git.providers[1].exit = {
      code: 0,
      signal: null
    }
  ],
  ['invented close checkpoint', a => a.git.checkpoints.normal_close_complete = true],
  [
    'checkpoint moved after second Commit',
    a => a.checkpoint.checkpoints.second_layerfs_commit = true
  ],
  ['Git fsck failed', a => a.command_18.exit = 1],
  ['Git history changed', a => a.command_16.stdout = 'f'.repeat(40) + '\n'],
  ['wrong Git command', a => a.command_04.args[6] = 'status'],
  ['missing ignored file', a => a.before = a.before.filter(f => f.path !== 'ignored/cache.bin')],
  ['manifest invalid hash', a => a.before[0].sha256 = 'x'],
  [
    'invented native Commit',
    a => a.git.providers[1].stdout =
        a.git.providers[1].stdout.replace('new_commit=false', 'new_commit=true')
  ],
  [
    'missing native token event',
    a => a.git.providers[1].stdout =
        a.git.providers[1].stdout.replace(/^NATIVE_HANDLE event=open .*\r?\n/m, '')
  ],
  [
    'wrong outstanding count',
    a => a.git.providers[1].stdout =
        a.git.providers[1].stdout.replace('files=8 directories=0', 'files=0 directories=0')
  ],
  [
    'missing metadata regression',
    a => a.metadata.stdout.text =
        a.metadata.stdout.text.replace('2 passed; 0 failed', '1 passed; 1 failed')
  ],
  ['wrong host binary', a => a.git.identity.host = 'f'.repeat(64)],
  ['file-first promoted', a => a.mapping.cases[2].normal_close = true],
  [
    'cancelled file-first promoted', a => a.mapping.cases[2].exit = {
      code: 0,
      signal: null
    }
  ],
  ['guard admitted', a => a.mapping_guard.exit = 0],
  [
    'wrong view-first order',
    a => a.mapping.cases[1].stdout =
        a.mapping.cases[1].stdout.replace('event=cleanup', 'event=close')
  ],
  ['mapping deadline promoted', a => a.mapping.cases[2].deadline_expired = true],
  ['reopen general qualification invented', a => a.reopen.general_close_qualified = true],
  [
    'reopen owner Unmap unproved',
    a => a.reopen.application.stdout =
        a.reopen.application.stdout.replace('unmapped=true', 'unmapped=false')
  ],
  [
    'reopen view use unproved',
    a => a.reopen.application.stdout =
        a.reopen.application.stdout.replace('view_readable=true', 'view_readable=false')
  ],
  ['reopen earlier close claimed', a => a.reopen.checkpoints.old_closed_while_view_live = true],
  [
    'reopen missing action',
    a => a.reopen.events = a.reopen.events.filter(e => e.name !== 'reopen-after-unmap-begin')
  ],
  ['reopen original identity changed', a => a.reopen.original_handle = '999'],
  ['reopen binary identity drift', a => a.reopen.identity.bridge = 'f'.repeat(64)],
  ['source tree drift', a => a.manifest.sources.reopen.tested = 'f'.repeat(40)],
  ['provenance upgraded', a => a.manifest.provenance = 'signed-build-attestation'],
  ['old binaries guessed current', a => a.manifest.old_binary_recheck = 'all-current'],
  ['Git harness seal invented', a => a.manifest.git_run_harness_hash = 'f'.repeat(64)],
  [
    'analyzer source drift',
    a => a.manifest.analyzers['tools/winfsp-handle-trace.mjs'] = 'f'.repeat(64)
  ],
  ['build failed', a => a.reopen_build.job.status = 'failed'],
];
for (const [name, mutate] of cases) {
  const c = structuredClone(raw);
  mutate(c);
  assert.throws(() => facts(c), name);
  console.log('PASS reject ' + name);
}
const memory = new DatabaseSync(':memory:');
try {
  const tables =
      db.prepare(
            'SELECT name,sql FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
          .all();
  for (const t of tables) {
    memory.exec(t.sql);
    for (const row of db.prepare('SELECT * FROM ' + t.name).all())
      memory
          .prepare(
              'INSERT INTO ' + t.name + ' VALUES(' + Object.keys(row).map(() => '?').join(',') +
              ')')
          .run(...Object.values(row));
  }
  const corruptions = [
    ['artifact bytes drift', 'UPDATE lifecycle_artifacts SET body=body||\' \' WHERE name=\'git\''],
    ['artifact digest drift', 'UPDATE lifecycle_artifacts SET sha256=\'f\' WHERE name=\'reopen\''],
    ['parsed Git close promoted', 'UPDATE git_evidence SET close_complete=1'],
    ['parsed after-manifest invented', 'UPDATE git_evidence SET independent_after_manifest=1'],
    ['parsed mapping general qualify', 'UPDATE lifecycle_evidence SET general_close_qualified=1'],
    [
      'baseline historical readiness changed',
      'UPDATE receipts SET status=\'PASS\' WHERE id=\'workspace-live\''
    ],
    ['baseline native identity changed', 'UPDATE native SET source_commit=\'changed\''],
    ['missing artifact', 'DELETE FROM lifecycle_artifacts WHERE name=\'manifest\''],
  ];
  for (const [name, sql] of corruptions) {
    memory.exec('BEGIN');
    try {
      memory.exec(sql);
      assert.throws(() => audit(memory), name);
    } finally {
      memory.exec('ROLLBACK');
    }
    console.log('PASS reject ' + name);
  }
  audit(memory);
} finally {
  memory.close();
  db.close();
}
assert.equal(hash(readFileSync(path)), before);
console.log('PASS source snapshot unchanged');
