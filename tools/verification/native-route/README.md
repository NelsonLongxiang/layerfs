# Native-route verification

> Status: Current verifier for the Windows Store route; Workspace readiness is a separate, intentionally non-green leaf until proved.

Extends the historical `spec_9a8d135fb270` four-writer scenario. Its material, reports and archives remain untouched; no old run is relabelled as current.

## Collect and freeze

Run from the LayerFS root on a clean tracked commit. The collector creates a new output directory, runs bounded child commands on fresh test Stores and records raw stdout/stderr, exit codes, source commit/tree and addon hash. It does not exercise the live host, launch commands in a real Workspace, enable ProjFS or run Durable.

```powershell
node tools/verification/native-route/tools/collect.mjs tmp/native-route-run-<unique>
ygl-trees verify meta tools/verification/native-route --json
ygl-trees verify submit --title "Native Store route receipt contract" --text tools/verification/native-route/materials/store.md --meta-repo tools/verification/native-route --json
ygl-trees verify prepare <store-material-id> --candidates tools/verification/native-route/materials/store-candidates.json --reviews tools/verification/native-route/materials/store-reviews.json --db tmp/native-route-run-<unique>/snapshot.sqlite --meta-repo tools/verification/native-route --json
ygl-trees verify run <store-spec-id> --db tmp/native-route-run-<unique>/snapshot.sqlite --json
ygl-trees verify archive <run-id> --snapshot tmp/native-route-run-<unique>/snapshot.sqlite --json
ygl-trees verify archive verify <archive.zip> --json
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

Run IDs and archive paths are recorded in the associated issue-352 verification result, not guessed here. Outputs and databases belong under task-specific tmp directories, not in this package. No schedule is installed.
