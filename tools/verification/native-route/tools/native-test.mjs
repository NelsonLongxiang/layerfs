// Parser/audit controls on copies only; no native operation or evidence mutation.
// node native-test.mjs <imported-snapshot>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {facts, audit, hash} from './native.mjs';
const path = process.argv[2];
assert.ok(path);
const originalHash = hash(readFileSync(path)), db = new DatabaseSync(path, {readOnly: true});
const raw = Object.fromEntries(db.prepare('SELECT name,body FROM native_artifacts')
                                   .all()
                                   .map(r => [r.name, JSON.parse(r.body)]));
const original = JSON.stringify(raw);
assert.equal(audit(db).native_runs, 5);
console.log('PASS native raw artifacts and derived facts');
const cases = [
  ['missing raw receipt', a => delete a.reopen],
  ['mixed bridge', a => a.concurrent.identity.bridge = 'f'.repeat(64)],
  [
    'wrong source seal',
    a => a.source_seal.stdout.text =
        a.source_seal.stdout.text.replace(a.manifest.probe_tree, 'f'.repeat(40))
  ],
  [
    'wrong host build',
    a => a.host_build.stdout.text = a.host_build.stdout.text.replace(
        /"binarySha256": "[A-F0-9]+"/,
        '"binarySha256": "' +
            'F'.repeat(64) + '"')
  ],
  ['signalled process', a => a.close.provider.exit.signal = 'SIGTERM'],
  [
    'deadline',
    a => a.cache.provider.finished =
        new Date(Date.parse(a.cache.provider.started) + 120001).toISOString()
  ],
  [
    'wrong independent Commit id',
    a => a.reopen.stdout = a.reopen.stdout.replace(
        /first=CommitId\([0-9a-f]+\)/,
        'first=CommitId(' +
            'f'.repeat(66) + ')')
  ],
  [
    'wrong Commit parent',
    a => a.native.stdout =
        a.native.stdout.replace('parent=Some(CommitId(', 'parent=Some(CommitId(f')
  ],
  [
    'no held descriptor',
    a => a.native.stdout = a.native.stdout.replaceAll('open_handles=1', 'open_handles=0')
  ],
  ['wrong remount Store', a => a.remount.store += '-copy'],
  ['re-Init on remount', a => a.remount.stdout += '\nSTORE_CREATED entries=88\n'],
  [
    'wrong remount head',
    a => a.remount.stdout = a.remount.stdout.replace(
        /head=Some\(CommitId\([0-9a-f]+\)\)/,
        'head=Some(CommitId(' +
            'f'.repeat(66) + '))')
  ],
  [
    'missing scope refusal',
    a => a.cache.provider.stdout =
        a.cache.provider.stdout.replace(/^COMMIT_SCOPE_REFUSED phase=3 .*\r?\n/m, '')
  ],
  [
    'implicit published result',
    a => a.cache.provider.stdout =
        a.cache.provider.stdout.replace('kind=Committed scope=published', 'kind=Committed')
  ],
  [
    'future cached byte',
    a => a.cache.provider.stdout = a.cache.provider.stdout.replace(
        'phase=3 application=67 published_before=', 'phase=3 application=67 published_before=99')
  ],
  [
    'wrong cache reopened byte',
    a => a.cache_reopen.stdout = a.cache_reopen.stdout.replace(' byte=68 ', ' byte=65 ')
  ],
  [
    'write after exact Close',
    a => a.cache.provider.stdout +=
    '\nCACHE_CLEANUP handle=999 flags=0 closes=0\nCACHE_CLOSE handle=999 cleanup=1\nCACHE_WRITE constrained=1 append=0 offset=0 requested=1 done=1 handle=999\n'
  ],
  [
    'concurrent generation mismatch',
    a => a.concurrent.provider.stdout =
        a.concurrent.provider.stdout.replace('CONFIRMED captured=1', 'CONFIRMED captured=9')
  ],
  [
    'no concurrent progress',
    a => a.concurrent.provider.stdout =
        a.concurrent.provider.stdout.replace('later_revision=5', 'later_revision=2')
  ],
  [
    'missing lane release',
    a => a.concurrent.lane.stdout = a.concurrent.lane.stdout.replace('LANE_RELEASED', 'UNPROVED')
  ],
  ['foreign interleaving receipt', a => a.interleaving.later_revision++],
  [
    'close before admission',
    a => a.close.provider.stdout =
        'NORMAL_CLOSE_STOP_BEGIN prepared=true\n' + a.close.provider.stdout
  ],
  [
    'mapped refusal missing',
    a => a.close.provider.stdout =
        a.close.provider.stdout.replace(/^NORMAL_CLOSE_REFUSED phase=3 .*\r?\n/m, '')
  ],
  [
    'view continuation unproved',
    a => a.close.application.stdout = a.close.application.stdout.replace(
        'mapped_write_after_refusal=true', 'mapped_write_after_refusal=false')
  ],
  ['product qualification invented', a => a.native.workspace_qualified = true],
  ['kernel inventory invented', a => a.close.general_section_inventory = true],
  ['scope guarantee invented', a => a.concurrent.application_visible_guarantee = true],
  [
    'Rust failure',
    a => a.rust_tests.stdout.text =
        a.rust_tests.stdout.text.replace('8 passed; 0 failed', '7 passed; 1 failed')
  ],
  ['missing baseline tables', a => a.manifest.baseline_tables = {}],
];
for (const [name, mutate] of cases) {
  const copy = structuredClone(raw);
  mutate(copy);
  assert.throws(() => facts(copy), name);
  console.log('PASS reject ' + name);
}
assert.equal(JSON.stringify(raw), original);
const memory = new DatabaseSync(':memory:');
try {
  for (const table
           of ['identity', 'preflight', 'receipts', 'projection', 'projection_artifacts', 'native',
               'native_artifacts']) {
    memory.exec(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table).sql);
    for (const row of db.prepare('SELECT * FROM ' + table).all())
      memory
          .prepare(
              'INSERT INTO ' + table + ' VALUES (' + Object.keys(row).map(() => '?').join(',') +
              ')')
          .run(...Object.values(row));
  }
  for (const [name, sql] of [
           [
             'artifact hash drift',
             'UPDATE native_artifacts SET sha256=\'wrong\' WHERE name=\'native\''
           ],
           [
             'artifact body drift',
             'UPDATE native_artifacts SET body=body||\' \' WHERE name=\'native\''
           ],
           ['derived field drift', 'UPDATE native SET mutation_commits=99'],
           ['missing artifact', 'DELETE FROM native_artifacts WHERE name=\'manifest\''],
           [
             'historic Workspace promoted',
             'UPDATE receipts SET status=\'PASS\' WHERE id=\'workspace-commit\''
           ],
           ['historic Store identity rewritten', 'UPDATE identity SET before_commit=\'changed\''],
  ]) {
    memory.exec('BEGIN');
    try {
      memory.exec(sql);
      assert.throws(() => audit(memory), name);
    } finally {
      memory.exec('ROLLBACK');
    }
    console.log('PASS reject ' + name);
  }
  assert.equal(audit(memory).artifact_count, 16);
} finally {
  memory.close();
  db.close();
}
assert.equal(hash(readFileSync(path)), originalHash);
console.log('PASS source snapshot unchanged');
