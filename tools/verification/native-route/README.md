# Native-route verification

> Status: Current verifier for the Windows Store route; Workspace readiness is a separate, intentionally non-green leaf until proved.

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
- Readiness: ProjFS availability, live ordinary-process filesystem use, stable capture-to-one-Commit and open-handle/mapping lifetime proofs. Only the preflight is implemented here; the three live proof rows are NOT_RUN.
- For each criterion, create a new snapshot copy and change/remove the exact fact it needs; never mutate the actual snapshot, frozen spec, report, or source Store. Empty snapshots must not pass.
- reviews.json is author self-review, not a claim of independent human arbitration. Public test assertions and negative snapshots provide mechanical validation.
- The Linux image is pinned in the collector and must already exist locally. Network is disabled and source bind-mounted read-only. It is a cross-check, never the product runtime.
- Snapshot/receipt hashes authenticate byte consistency, not the honesty of an arbitrary producer or source-to-binary provenance. The installed addon is identified, not rebuilt by this collector.
- A Windows home-mode SKIP is not a Windows ACL proof. A host/UI SKIP is not a GUI acceptance. Current Workspace remains Unsupported.

## Local results

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
