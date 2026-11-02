# Native-route verification

> Status: Current retained-evidence verifier for Windows Store, projection, diagnostics and product runtime/restricted/resident integration; historical readiness and full SDK qualification remain separate.

Extends the historical `spec_9a8d135fb270` four-writer scenario. Its material, reports and archives remain untouched; no old run is relabelled as current.

## Fixed engine for new runs

The npm/global 0.118.0 binary does not contain the merged #140 correction.
New runs use the tested candidate from [engine-pin.json](engine-pin.json),
built from ygl-trees e5876e07 (PR #145). It still reports version 0.118.0,
so the launcher checks all five bundle chunks plus package/composition/corpus
manifest hashes, not a version string alone. It requires an explicit home
and never substitutes the global CLI or default workspace. External runtime
dependencies are recorded, not authenticated by the bundle pin.

This is a local source candidate, **not** an npm release or signed distribution.
Build/qualification and exact machine-local location are in the
[engine adoption result](../../../core/docs/issues/352/ENGINE-FOLD-2026-11-01.md).
If the pinned export is missing, rebuild the exact source and verify it; do not
change the pin to accept an arbitrary build. Re-evaluate this temporary launcher
when a qualified published replacement is available (registered sunset 0.119.0).

## Collect and freeze

Run from the LayerFS root on a clean tracked commit. The collector creates a new output directory, runs bounded child commands on fresh test Stores and records raw stdout/stderr, exit codes, source commit/tree and addon hash. It does not exercise the live host, launch commands in a real Workspace, enable ProjFS or run Durable.

```powershell
$engine = "<fixed-engine-export-root>"
$home = "<absolute-isolated-verifier-home>"
$runner = "tools/verification/native-route/verify/orchestration/engine.mjs"
node $runner --engine $engine --home $home -- db init --json
node tools/verification/native-route/tools/collect.mjs tmp/native-route-run-<unique>
node $runner --engine $engine --home $home -- verify meta tools/verification/native-route --json
node $runner --engine $engine --home $home -- verify submit --title "Native Store route receipt contract" --text tools/verification/native-route/materials/store.md --meta-repo tools/verification/native-route --json
node $runner --engine $engine --home $home -- verify prepare <store-material-id> --candidates tools/verification/native-route/materials/store-candidates.json --reviews tools/verification/native-route/materials/store-reviews.json --db tmp/native-route-run-<unique>/snapshot.sqlite --meta-repo tools/verification/native-route --json
node $runner --engine $engine --home $home -- verify run <store-spec-id> --db tmp/native-route-run-<unique>/snapshot.sqlite --json
node $runner --engine $engine --home $home -- verify archive <run-id> --with "materials,snapshot" --snapshot tmp/native-route-run-<unique>/snapshot.sqlite --out tmp/native-route-run-<unique>/<run-id>.yglverify.zip --json
node $runner --engine $engine --home $home -- verify archive verify <archive.zip> --json
```

Repeat submit/prepare/run for `workspace.md`, `workspace-candidates.json`, and `workspace-reviews.json` using the same snapshot. A Workspace FAIL is a readiness result, not evidence that the Store failed. A recursive all_pass tree retains the two leaf verdicts; missing/unrun Workspace proofs cannot yield an overall PASS.

## Scope and counterexamples

- Store: ten Windows runtime cases, explicit POSIX-only SKIP, real SDK operations and refusals, two report regressions, three Linux comparison cases, identity and receipt completeness.
- Historical readiness: ProjFS availability plus three live proof rows remain frozen at their original collection time. The newer native diagnostic leaf records subsequent WinFsp progress without rewriting these rows or claiming product SDK qualification.
- For each criterion, create a new snapshot copy and change/remove the exact fact it needs; never mutate the actual snapshot, frozen spec, report, or source Store. Empty snapshots must not pass.
- reviews.json is author self-review, not a claim of independent human arbitration. Public test assertions and negative snapshots provide mechanical validation.
- The Linux image is pinned in the collector and must already exist locally. Network is disabled and source bind-mounted read-only. It is a cross-check, never the product runtime.
- Snapshot/receipt hashes authenticate byte consistency, not the honesty of an arbitrary producer or source-to-binary provenance. The installed addon is identified, not rebuilt by this collector.
- A Windows home-mode SKIP is not a Windows ACL proof. A host/UI SKIP is not a GUI acceptance. Current Workspace remains Unsupported.

## Import the real Store projection proof

[projection.md](materials/projection.md) adds a third, independent diagnostic leaf.
It checks eight clauses: receipt identity, lazy startup, fixed-root challenge,
ordinary-process reads, untouched file, read-only Store boundary, explicit unimplemented
scope, and retained raw artifacts. It does **not** satisfy Workspace W2/W3/W4.

Use [projection.mjs](tools/projection.mjs) with a closed baseline and the retained
four-case Store smoke directory. It copies the baseline into a **new** directory,
embeds five original JSON artifacts, and retains source/time attribution separately.
This is an evidence import, not a fresh product test; existing rows are not updated.

```powershell
node tools/verification/native-route/tools/projection.mjs <baseline.sqlite> <retained-store-smoke-directory> <full-probe-source-commit> <new-output-directory>
node tools/verification/native-route/tools/projection.mjs --audit <new-output-directory>/snapshot.sqlite
node tools/verification/native-route/tools/projection-test.mjs <retained-store-smoke-directory> <new-output-directory>/snapshot.sqlite
```

The separate read-only audit recomputes embedded artifact hashes and all parsed facts;
the SQL leaf checks facts and presence, not arbitrary producer honesty. Run the audit
before leaf verification and after extracting an archived snapshot. No local projection
path needs to remain mounted. The existing harness's success includes its on-disk
untouched-file assertion, not a fresh disk inspection during import.

Submit/prepare/run projection material with its candidates/reviews using the pinned
engine, just as for the other leaves. The checked-in
[three-leaf material](materials/tree-projection.json) names the retained round-57
snapshot. Use the **tree_spec_id returned by prepare**, not the proposed name.
For new evidence, submit a new target; never overwrite old tree/run identities.
The mixed-source tree deliberately has no single subject.commit: each source is in
the snapshot/import receipt. Preserve both read times in reports.

The three leaf archives include materials and snapshot bytes. Generated aggregate
reports have neither prepare.material_id nor data_source.sha256 in this engine:
keep/verify their normal report/spec archive, and distribute it beside the leaves.
Do not fabricate those fields to force --with materials,snapshot on the aggregate.

Round-57 [results and limits](../../../core/docs/issues/352/NATIVE-VERIFIER-PROJECTION-2026-11-01.md)
record 19 parser/audit checks, 25 synthetic cases and the three-leaf FAIL.
The optional meta-tooling --audit --against-git reports a known nested-root
path failure; ordinary verify meta and chain audit passing do not erase it.
When a projection table exists, counterexamples.mjs adds ten cases (positive,
P1–P8 and empty); older snapshots retain the original 15-case behavior.

## Local results

The [real Store read-only ProjFS proof](../../../core/docs/issues/352/PROJFS-STORE-READ-2026-11-01.md) is a separate diagnostic milestone. It is not the Workspace read/write/capture proof required by the frozen W2/W3/W4 criteria; do not promote those rows from NOT_RUN using the read-only result.

Run IDs and archive paths are in [the issue-352 result](../../../core/docs/issues/352/NATIVE-VERIFIER-2026-11-01.md). Outputs and databases belong under task-specific tmp directories, not in this package. No schedule is installed.

```powershell
node tools/verification/native-route/tools/counterexamples.mjs tmp/native-route-run-<unique>/snapshot.sqlite tmp/native-route-negatives-<unique>
node $runner --engine $engine --home $home -- verify tree prepare <tree-material-id> --json
node $runner --engine $engine --home $home -- verify tree run <tree-spec-id> --db tmp/native-route-run-<unique>/snapshot.sqlite --json
```

The checked-in tree material identifies the retained dec1c3486 snapshot. For a new collection, submit new tree material with its actual snapshot basename, sha256 and source commit; keep tree_spec_version=1 (schema version). Do not retarget a frozen tree silently. The original mismatched-target STALE run is retained.

The fixed entry is temporary orchestration, registered as invoke with a 0.119.0 re-evaluation boundary; it is not an automatic switch or release promise.

The former 0.118.0 STALE archives are deliberately retained and still rejected.
A clean candidate workspace self-check does not make the default workspace
containing those historical invalid bytes green; its report must remain honest.

## Native WinFsp diagnostic evidence

[native.md](materials/native.md) adds nine independent criteria for retained native
mutation/Commit, same-Store remount, explicit guarantee scope, one controlled
concurrent-write interleaving, normal close admission, identity and raw evidence.
The [importer](tools/native.mjs) copies a closed Store/projection baseline into a
new snapshot, embedding fifteen original JSON receipts plus its import manifest.
It does not mount, write a Store, rebuild a binary, or rerun a product test.

The importer checks current retained executable bytes against the receipt hashes,
the declared source commit and tested subtree, host build receipt, Commit ancestry
and independent reopen, generation/revision changes and close ordering. Its audit
recomputes every derived field, embedded hash and all original baseline table
hashes. It reuses the existing cache and close analyzers, now import-safe; their
native CLI behavior is unchanged. An archived audit needs only the snapshot and
validator, not the original machine's binary paths. Import itself still requires
those retained binaries for the initial byte check; it never substitutes others.

```powershell
node tools/verification/native-route/tools/native.mjs <closed-baseline.sqlite> <native-proof-directory> <full-tested-source-commit> <fresh-output>
node tools/verification/native-route/tools/native.mjs --audit <fresh-output>/snapshot.sqlite
node tools/verification/native-route/tools/native-test.mjs <fresh-output>/snapshot.sqlite
```

Use the fixed engine and explicit isolated home for submit/prepare/run as above.
The [four-leaf tree](materials/tree-native.json) pins the round-70 snapshot; it is
mixed-source evidence, not a fresh single-commit product qualification. Preserve
each source and its original read time. The historical Workspace leaf is named
accordingly: its FAIL does not deny later diagnostic capabilities, and native
9/9 does not turn product Workspace into a supported API. Frozen historical
specs/reports remain untouched; only a new material/target can select new facts.

Final checks: 37 parser/audit controls (including 35 corruptions), 36 synthetic
criterion cases (three positive fixtures, 33 negatives), and existing cache/close
analyzer self-tests. Synthetic positives test predicates only. Four leaf archives
carry materials and the full snapshot; each extracted snapshot is byte-equal and
re-audited. The aggregate keeps the engine's normal report/spec archive. See the
[round-70 report](../../../core/docs/issues/352/NATIVE-VERIFIER-WINFSP-2026-11-02.md).

SQL PASS checks derived facts, not provenance on its own. Run raw audit before
verification and after extraction. Neither hashes nor local unsigned archives
prove an arbitrary producer truthful or provide source-to-binary build attestation.
General callbacks, complete kernel section inventory, mapped-page synchronization,
crash recovery, sandbox/UI integration and product SDK Workspace remain unqualified.

## Git and readonly mapping lifecycle leaves

[Git material](materials/git.md) adds seven criteria and preserves the complete
Git workload's FAIL (six PASS, normal-close criterion FAIL). It records nineteen
Git commands, seventeen before-manifest files and the original remount assertion.
There is no separately retained after-manifest: this is disclosed, not fabricated
and not an additional product acceptance gate. Windows metadata's three focused
Rust tests are separate from live kernel/NTFS qualification.

[Readonly lifecycle material](materials/lifecycle.md) adds eight observation
criteria. Ordinary reads and view-first release close normally; File-first release
retains one Cleanup without Close. A separate owner-controlled experiment proves
Busy-time reads remain usable, then observes original Close after owner release
and one readonly reopen. Its PASS never means generic unmount qualification.

The [importer](tools/lifecycle.mjs) copies a closed round-70 native snapshot into a
fresh directory and embeds 36 original JSON receipts plus one manifest. It reuses
the existing handle/coordination analyzers, rechecks all seven baseline tables and
keeps original source/time and mixed binary identities. Initial import rechecks
only currently retained reopen binaries. Older DLLs were replaced by subsequent
shared builds, so their recorded hashes are not asserted to match current bytes.
The original traced Git run did not record a complete harness hash; its attribution
is declared and checked against selected source subtrees, not a clean build seal.

```powershell
node tools/verification/native-route/tools/lifecycle.mjs <closed-native-baseline.sqlite> <fresh-output>
node tools/verification/native-route/tools/lifecycle.mjs --audit <fresh-output>/snapshot.sqlite
node tools/verification/native-route/tools/lifecycle-test.mjs <fresh-output>/snapshot.sqlite
node tools/verification/native-route/tools/lifecycle-counterexamples.mjs <fresh-output>/snapshot.sqlite <fresh-synthetic-output>
```

[Six-leaf material](materials/tree-lifecycle.json) pins the round-77 mixed snapshot.
New specs supplement, never retarget, the four historical leaves. The raw audit
requires these exact analyzer sources; archived snapshots need no old host binary
paths, but do not establish arbitrary-producer honesty or signed source/binary
provenance. Run raw audit before verification and after extracting archive snapshots.
Use the same pinned engine and explicit isolated home. The retained result is four
PASS leaves, two FAIL leaves (historical Workspace and Git close), aggregate FAIL.

Checks: 43 parser/audit controls including 41 corruptions, 19 new synthetic predicate
fixtures (two positive, seventeen negative), and 37 unchanged native audit checks.
The six leaf archives contain materials and exact snapshot bytes; each extracted
snapshot is re-audited. The aggregate keeps its ordinary report/spec archive.
See the [lifecycle verifier result](../../../core/docs/issues/352/NATIVE-VERIFIER-LIFECYCLE-2026-11-02.md).

## Product runtime, restricted access and resident-instance leaves

The [product](materials/product.md), [restricted](materials/restricted.md) and
[resident-instance](materials/instance.md) materials add three scoped retained
integration leaves. They do not retarget any historical spec or replace the
historical Workspace/Git failures. The [nine-leaf tree](materials/tree-product.json)
names the exact round-95 snapshot and preserves mixed source commits/read times.
Its result is seven PASS leaves and two FAIL leaves, aggregate FAIL.

The [product importer](tools/product.mjs) copies the closed round-77 lifecycle
snapshot and embeds 145 original artifacts, including four exact committed test
harnesses. It recomputes raw process/control/permission outcomes, original target
exit vs stream/normal-unmount ownership, restricted backend access and resident
handle release. Each source retains its own tested subtree, committed source and
recorded binary hashes. Only the resident test's current binaries are byte-checked
at import; replaced older binaries are explicitly not asserted current.

The importer launches no product, does not read project credentials or source
Stores, and adds no DACL/configuration change. Archived audit needs only the
snapshot and fixed analysis sources; derived SQL rows alone are not provenance.
Remount/dual-mount/active-close/no-autostart checks keep the original public test's
assertion level and exact harness, not an invented independent event or manifest.
Neither snapshots nor hashes prove arbitrary-producer honesty or signed builds.


```powershell
node tools/verification/native-route/tools/product.mjs <closed-lifecycle-baseline.sqlite> <fresh-output>
node tools/verification/native-route/tools/product.mjs --audit <fresh-output>/snapshot.sqlite
node tools/verification/native-route/tools/product-test.mjs <fresh-output>/snapshot.sqlite
node tools/verification/native-route/tools/product-counterexamples.mjs <fresh-output>/snapshot.sqlite <fresh-synthetic-output>
```

The [raw-audit controls](tools/product-test.mjs) reject altered bytes, identity,
permission or lifecycle outcomes and changes to old facts. The
[predicate counterexamples](tools/product-counterexamples.mjs) create independent
copies only: three positive and 27 negative/empty cases test the new 24 criteria.
These synthetic copies are not raw-auditable product proofs.

Use the unchanged pinned engine and explicit isolated home. Every leaf archive
includes its original material and complete snapshot; the ordinary tree-generated
aggregate archive contains only its legitimate report/spec. The manual archive
command defaults to materials and therefore refuses a group without material_id;
keep the original tree-generated aggregate rather than fabricating fields.
Snapshot bytes are rechecked and raw-audited after extraction. Deterministic archive
verification is separate from signing: the pinned local candidate is not a signed
sealed distribution. No key is minted or self-trusted to make that claim.

See the [round-95 result](../../../core/docs/issues/352/NATIVE-VERIFIER-PRODUCT-2026-11-02.md).
The native SDK Sandbox/Workspace dispatch, complete host isolation, mapping/kernel
drain, general Git normal close and crash recovery remain unqualified. This update
imports earlier functional receipts; it is not a new live execution or fresh
single-commit qualification.
