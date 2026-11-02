// Predicate fixtures only, not real or auditable lifecycle observations.
import assert from 'node:assert/strict';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {hash, audit} from './lifecycle.mjs';
const source = resolve(process.argv[2] ?? ''), out = resolve(process.argv[3] ?? '');
assert.equal(process.argv.length, 4);
assert.ok(!existsSync(out));
assert.ok(!existsSync(source + '-wal'));
const digest = hash(readFileSync(source)), db = new DatabaseSync(source, {readOnly: true});
try {
  audit(db);
} finally {
  db.close();
}
mkdirSync(out);
const groups = {
  git: {
    seed:
        'UPDATE git_evidence SET close_complete=1,remaining_handles=0',
    cases: {
      positive: '',
      G1: 'UPDATE git_evidence SET identity_checked=0',
      G2: 'UPDATE git_evidence SET metadata_tests=2',
      G3: 'UPDATE git_evidence SET git_commands=18',
      G4: 'UPDATE git_evidence SET independent_after_manifest=1',
      G5: 'UPDATE git_evidence SET close_complete=0,remaining_handles=8',
      G6: 'UPDATE git_evidence SET qualification=1',
      G7: 'DELETE FROM lifecycle_artifacts WHERE name=\'git\'',
      empty: 'DELETE FROM git_evidence; DELETE FROM lifecycle_artifacts'
    }
  },
  lifecycle: {
    seed: '',
    cases: {
      positive: '',
      L1: 'UPDATE lifecycle_evidence SET identity_checked=0',
      L2: 'UPDATE lifecycle_evidence SET view_first_close=0',
      L3: 'UPDATE lifecycle_evidence SET file_first_busy=0',
      L4: 'UPDATE lifecycle_evidence SET no_early_close=0',
      L5: 'UPDATE lifecycle_evidence SET original_close_after_reopen=0',
      L6: 'UPDATE lifecycle_evidence SET guard_refusals=2',
      L7: 'UPDATE lifecycle_evidence SET general_close_qualified=1',
      L8: 'DELETE FROM lifecycle_artifacts WHERE name=\'reopen\'',
      empty: 'DELETE FROM lifecycle_evidence; DELETE FROM lifecycle_artifacts'
    }
  }
};
const fixtures = [];
for (const [group, g] of Object.entries(groups))
  for (const [name, sql] of Object.entries(g.cases)) {
    const file = join(out, group + '-' + name + '.sqlite');
    copyFileSync(source, file);
    const db = new DatabaseSync(file);
    try {
      if (g.seed) db.exec(g.seed);
      if (sql) db.exec(sql);
    } finally {
      db.close();
    }
    fixtures.push({
      group,
      name,
      file,
      synthetic: true,
      expected: name === 'positive' ? 'PASS' : 'FAIL',
      mutation: sql
    });
  }
assert.equal(hash(readFileSync(source)), digest);
writeFileSync(
    join(out, 'manifest.json'),
    JSON.stringify(
        {
          source,
          sha256: digest,
          qualification:
              'synthetic predicate tests only; intentionally not raw-auditable product evidence',
          fixtures
        },
        null, 2));
console.log('Created ' + fixtures.length + ' SYNTHETIC lifecycle fixtures; source unchanged');
