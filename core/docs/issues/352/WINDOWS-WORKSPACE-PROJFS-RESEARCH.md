# Windows-native Workspace: ProjFS feasibility boundary

> **Status:** Research; informative and not a product contract.
> Checked 2026-11-01, Asia/Shanghai. Baselines: LayerFS `36a175bf9`, plugin `3fb523e`.

## Verified state

The [handoff](HANDOFF-2026-11-01.md) describes a Store-only route. No Windows Workspace
implementation or production fallback is introduced by this note. Plugin UI edits in
the shared checkout are unrelated and left untouched. PR #452 is OPEN; plugin #6/#7
are CLOSED, not merged. Upstream PRs are not reopened without authorization.

On this host, ProjectedFSLib.dll and prjflt.sys are absent; the session is not elevated.
DISM /Online /Get-FeatureInfo /FeatureName:Client-ProjFS /English returned 740.
The servicing state is therefore unknown, not a successful Disabled query. No mount ran.

## Projection is not Overlay write interception

Microsoft documents [cache states](https://learn.microsoft.com/en-us/windows/win32/projfs/cache-state):
reads hydrate placeholders on disk, writes create full files, local entries override
projected entries, and deletions leave tombstones. Near-zero allocation is not a
guarantee after hydration or writes.

[Operation notifications](https://learn.microsoft.com/en-us/windows/win32/projfs/file-system-operation-notifications)
can be pre-operation vetoes or post-operation notifications; modified-file notification
may arrive at handle close. A notification does not deliver every write payload/range
to a LayerFS Overlay transaction. [Shutdown](https://learn.microsoft.com/en-us/windows/win32/projfs/virtualization-instance-lifecycle)
can still deliver callbacks until PrjStopVirtualizing returns; it is not proof that
all external handles or mappings have released their files.

The installed windows-sys 0.61.2 includes ProjFS bindings. This proves API bindings
exist, not a working provider. [OverlayRead/OverlayJobs](../../../../engine/crates/layerfs-workspace/src/ports/overlay.rs)
provide bounded atomic jobs; [CapturedNamespace](../../../../engine/crates/layerfs-workspace/src/construction/driver.rs)
constructs from an exact captured reader, not a changing directory. Notifications
alone do not create that immutable frontier. The Workspace crate forbids unsafe code;
its current FFI allowlist does not automatically authorize new ProjFS callbacks.

## Next bounded live experiment

An isolated provider proof must precede a new public adapter interface:

1. Pin an immutable root, enumerate/read from an ordinary native process, prove exact bytes.
2. Observe create/write/truncate/rename/delete/recreate, identity and tombstones.
3. Hold a writable handle and mapping across capture: prove stable bytes/frontier or
   refuse exactly. Process exit is not a file-reference drain.
4. Transfer captured changes through the existing Overlay constructor, Save and history
   publication once, then reopen and verify one Commit including deletions.
5. Stop/crash/reopen: drain callbacks and retain uncertain changes; do not replay a mutation.

Case sensitivity, hard links, reparse points, unpaired surrogates, concurrent mutation
and mapped writes require explicit compatibility results. Ordinary process execution
remains external to the filesystem provider.

A materialize/watch experiment may explore a narrower quiescent copy-in/copy-out workflow.
It is not the current Workspace contract: mount forbids whole-tree materialization,
and a watcher is not a stable captured frontier. Do not silently implement it as
workspace.exec or a fallback, or treat fs.apply/re-Init as Workspace Commit.

## Administrator action and executable prerequisite check

[tools/projfs-preflight.ps1](../../../../tools/projfs-preflight.ps1) is read-only: it checks
library presence, load and exports, unloads it, and never invokes a mount. Exit 0 means
API-load candidate only; 2 unavailable; 1 probe error. liveMountVerified is always false.

```powershell
pwsh -NoProfile -File D:/workspace/layerfs/tools/projfs-preflight.ps1
# In an authorized, elevated PowerShell:
DISM /Online /Enable-Feature /FeatureName:Client-ProjFS /All /NoRestart
```

Preserve DISM output. If restart is requested (including 3010), arrange a separate
window; do not restart DSH or the machine automatically. Re-run the read-only probe
afterwards. Enabling the component is an environment prerequisite, not the sole
remaining engineering prerequisite and not an upstream publication authorization.

## Takeover verification corrections

Runtime init normalizes only the compared local path. Docker-default uses USERPROFILE
on Windows and HOME on Unix, restoring the prior value. The Unix home-mode assertion
is preserved and passes on Linux; Windows reports SKIP, not a fake PASS.

The route test previously passed its main-write refusal check even if the write succeeded.
It now passes only after ReadOnly. The [regression](../../../../api/agent/test/route-native-report.mjs)
proves a permissive binding fails this check and all-skipped is never ALL PASS.

Windows: runtime 10 PASS + 1 SKIP; actual installed native addon SDK 7 PASS, 0 FAIL,
1 host-face SKIP. Linux node 22.23.4: home-mode/init/docker-default PASS; report
skip-accounting PASS. The Linux container is a test oracle, not the product route.
Host/UI was not rerun. Addon SHA256:
`7e673c483966e52554448bfe9887ee2c2a4ef37e0bdbddf2c3a7e9632d1a757c`.
It was not rebuilt. Raw receipts are in the ignored
[takeover-20261101 directory](../../../../tmp/takeover-20261101/).

GitHub observation at 17:24 +08: repository permissions.enabled=true; ci/format/nightly
are active. [Existing run 41236202880](https://github.com/NelsonLongxiang/layerfs/actions/runs/41236202880)
is successful at 1443753b4, not this patch or the handoff head. This does not prove the
new route lane ran or exclude another platform restriction. No workflow was triggered.

No product source, manifest, dependency, ACL, profile or running host changed.
No new taste decision was made: the boundaries above follow measured results and
documented interfaces; this note ratifies no proposal.
