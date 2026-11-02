# Restricted Windows Git cwd topology fix（2026-11-03）

> **Status:** Dated implementation and scoped functional verification record. Restricted resident SDK Git init/add/commit/show, publication/remount and normal close pass with an accessible caller-selected parent chain. General DOS-volume naming, arbitrary private ancestors and full isolation are not qualified.

## Implemented fix

**PASS for the pinned restricted SDK Git path.** The original resident mount topology put the fresh junction under its protected instance work directory. Git2.46.0.windows.1 opens cwd, attempts DOS final-path resolution, then falls back to GetLongPathNameW. That fallback enumerated the protected instance directory and failed Access denied. The private backend directory was unintentionally also an ancestor of the application-visible mount.

The [original instance mount method](../../../../api/runtime/src/platform/native-windows/instance.js) now places a fresh junction beside the instance work directory, using a bounded component name layerfs-<instance UUID>-<mount sequence>-mount. Backend overlay/template work remains under the unchanged protected instance directory. Only the work/path spelling changes; the original NativeSessions owner, policy SID, resident token/private desktop, launcher handoff, native Session, Commit and close controls stay the same.

No existing ancestor ACL is altered. There is no Mount Manager registration, DOS-drive alias, UNC/network backend, kernel-driver change, extra registry, launch cwd reinterpretation, Git/libuv patch, ordinary-token fallback, Store RPC or WSL worker. This is a path-topology correction, not a widening of the restricting token or a new security guarantee. [Public contract](../../../../api/docs/runtime.md#resident-native-execution-instances), [architecture](../../architecture/68-native-workspace-control.md#resident-windows-native-execution-instance-2026-11-02).

The same original manager still claims work and mount paths synchronously before awaiting. Fresh-target, overlap, instance capacity, retained-command and normal-close admission are unchanged. Numbered backend work is still private. New public-facing sibling names do not append the caller's work basename, so a230-character work component does not force a too-long junction component.

## Actual public-API investigation

The [retained old cwd observation](../../../../tmp/native-sdk-git-20261103/cwd-native/cwd-diagnostic.json) established that current directory acquisition, directory open and SetCurrentDirectoryW worked, while DOS GetFinalPathNameByHandleW returned1005 and GetLongPathNameW returned5. Fixed [Git mingw_getcwd](../../../../tmp/native-sdk-git-20261103/git-mingw.c) uses the latter as a fallback. Ordinary relative I/O success alone did not prove this operation.

The fixed [WinFsp mount source](../../../../tmp/native-sdk-streams-20261103/upstream-mount.c) also explicitly refuses directory junctions pointing to network volumes, so simply selecting WinFsp.Net would not preserve the existing junction product contract. The previously withdrawn Mount Manager experiment was not retried; its failure/system-state caveat remains in the [old record](WINDOWS-NATIVE-SDK-GIT-2026-11-03.md).

Before editing product code, an explicitly standalone restricted Session with work and mount as independent siblings passed long-path fallback, Git init and normal close through existing public APIs. [Sibling-first result](../../../../tmp/native-git-cwd-20261103/sibling-first/result.json) is only that original proof; it is not relabeled as resident SDK qualification. This ruled in the smaller topology change without changing access policy or volume registration.

## Restricted resident SDK chain

The final [public consumer](../../../../api/runtime/test/verify/native_git_cwd_real.mjs) uses actual SDK Init/fork, runtime.native.create, bindClient, SDK mount/exec/commit/unmount and original sandbox.close. Default mode is resident-sdk; a standalone run must be explicitly selected and never follows a refused resident operation. Every command has restricted:true, original root/finished/EOF receipts and no cancellation.

[Final result](../../../../tmp/native-git-cwd-20261103/resident-final/result.json), read **2026-11-02T20:53:47.971Z** (2026-11-03 04:53:47 Asia/Shanghai), [command receipt](../../../../tmp/native-git-cwd-20261103/resident-final-command.json), [audit](../../../../tmp/native-git-cwd-20261103/audit-command.json):

1. Original resident creates once, and SDK returns the same policy-bound native mount with its new sibling name. No alternate process, token or Store is selected after a failure.
2. The existing external [public-Win32 cwd observer](../../../../engine/crates/layerfs-sandbox/tests/windows_cwd_probe.cpp) opens both mount root and repo and obtains **two successful GetLongPathNameW results**. DOS final-path naming still returns1005; the successful fallback, not new DOS-volume identity, makes pinned Git usable.
3. Five actual restricted Git calls pass: init, add, commit, show and show after remount. Git creates root commitdcc4643 in this fixture. The file contains restricted SDK Git content plus newline. All original exit codes are0 and both output streams reach EOF; the two observers intentionally exit7 and are not misclassified as command failures.
4. Before the explicit LayerFS Commit, SDK fs.read is NoSuchPath and History has0items. SDK Published Commit returns original head **12672b1d45fb8bd874a40f2772fa0968cbdc9aea8603afcd78fdadb24d4c578706**, parent:null, rootef1831fe225166d1d86469c6132552667113632c017442c7fe200490fc774ed5. Independent SDK text/History readback agrees.
5. After one normal SDK unmount, another mount on the same still-running resident preserves the exact .git/index SHA256 **83d851512612fea60d8d992d403e209d1eaa2ba55dc0e56ea6310dbeb13f3e99**, the300023-byte ignored binary and Git history contents. The fresh sibling mount uses a different sequence. This proof checks exact index and binary bytes plus history content, not a complete manifest of every Git metadata path or staged/unstaged state for this restricted run.
6. Two original normal Workspace terminals report nativeExit0, overlayClosed:true, parent processExit0 and processSignal:null. The original instance remains the same PID until explicit close; its tokenClosed:true, desktopClosed:true and processExit0 complete the chain. Final runtime_closed:true and sessions empty.

A separate [post-close SDK readback](../../../../tmp/native-git-cwd-20261103/post-close-readback.json) reads the already closed test Store without remount or workload replay: exactly1History row with matching head/root/parent, working text exact and ignored binary size300023. Its separate reading time is preserved; it does not backdate or replace the in-run observation.

## Backend protection and unchanged ACLs

The existing [access observer](../../../../tmp/native-instance-20261102/probe-observed/restricted-probe.exe) runs through the same original restricted SDK exec:

- Token restricted=1, integrity4096.
- Four private objects—global Store, project.record, active overlay and native template—each refuse READ and WRITE_DAC/WRITE_OWNER, all error5.
- Three original parent processes—native Session parent, runtime caller and original resident—each refuse memory and token access, all error5. The unrestricted command launcher and its token also refuse access.
- [ACL before](../../../../tmp/native-git-cwd-20261103/resident-final/acl-before.json) and [ACL after](../../../../tmp/native-git-cwd-20261103/resident-final/acl-after.json) are identical for the existing common parent, SDK home and original instance work directory. Instance work remains a protected owner-only DACL. No chmod/icacls on those existing ancestors is used to make the test pass; the fixture only creates its new owner-private home before the before-snapshot.

The preexisting common parent chain already permits metadata queries to the token's ordinary groups. That environment fact is not an implementation claim of full confinement. Moving the mount does not make other public host objects private, prevent same-user races or turn the UUID into a secret. Existing per-policy junction read/traverse0x1200a9, noninheritance and mounted-volume data grants are unchanged.

## Regression and scope

Seven final original-owner protocol scenarios pass: scope, mixed direct/SDK owners, pending-mixed control, shared16capacity, direct-loss-bootstrap retained custody, mount-path-guards and long-work-name. [Tests](../../../../api/runtime/test/native-client.mjs) verify existing sibling targets are never replaced, a subsequent explicit mount gets a distinct sequence, standalone/other-instance overlapping claims refuse Busy, and a230-character work basename does not enlarge the sibling component.

The [existing actual SDK client consumer](../../../../api/runtime/test/verify/native_client_real.mjs) also passes at final naming: SDK/direct cross-entry mounts and unmounts, Dirty/service-kept before effects, Published/UpToDate/independent History, binary remount, unread command streams retaining their original owner and checked token/desktop terminal. [Client result](../../../../tmp/native-git-cwd-20261103/client-sealed/result.json), read20:53:49.829Z, final runtime_closed:true/sessions empty.

Node syntax checks precede each selection. All tests run in foreground under explicit20/90/100-second limits. [Product boundary checks](../../../../tmp/native-git-cwd-20261103/guards-final.json) scan1016files and pass37guard plus23LOC self-tests. Product changes are JavaScript only; Rust/C++/launcher/token code and dependencies are unchanged, so their build, Rust tests, Clippy and strict MSVC rebuild are NOT_RUN this slice. Existing binary/build receipts keep their original identity rather than being counted as a new build.

Intermediate standalone/sibling-name prototype and earlier client/protocol runs remain distinct evidence. The final implementation switched to a bounded UUID/sequence component instead of appending to the caller's work basename; final-* protocol cases, resident-final and client-sealed cover that actual source. No unchanged workload is re-sampled for a better outcome.

### Limits and warning retained

- The DOS GetFinalPathNameByHandleW query still returns1005. Other applications requiring DOS-volume identity, Git symlink-enabled chdir paths or different configuration may still fail. No general fix for those APIs is claimed.
- The caller-selected work parent and ancestors must already permit required metadata queries. A higher private ancestor can still prevent GetLongPathNameW. The runtime does not repair, broaden or bypass its permissions, and no new preflight gate is added.
- Git add emits one retained warning that it cannot read the owner's user-level .config/git/ignore. Exit0, exact commit contents and remount were independently checked. No user/profile/global-Git configuration was modified or warning suppressed; this is not a claim that user config lookup is fully compatible.
- A post-close diagnostic script initially failed Node syntax checking because its literal newline was incorrectly escaped; no Store read had run. The script was corrected and its [successful readback](../../../../tmp/native-git-cwd-20261103/post-close-readback-final-command.json) is separate from the [failed syntax receipt](../../../../tmp/native-git-cwd-20261103/post-close-readback-command.json). Product and functional workload were not rerun for it.
- [Old cwd exit128](../../../../tmp/native-sdk-git-20261103/actual-first/result.json), [old13reference FAIL](../../../../tmp/native-sdk-git-20261103/trusted-first/result.json) and old8/verifier failures retain original inputs and verdicts. This new layout does not re-adopt those original owners or retroactively qualify them. Named IPC is still unsupported; no token/pipe DACL broadening or third-party patch is made.
- This one-publication restricted proof is not the earlier trusted-local two-publication full-view proof, an OCI/Bash implementation, arbitrary kernel/mapping drain, crash recovery or installed/signed release qualification.

## Source and exact production LOC

First parent **63f0b2a0cbf736d785961f66db9c73d51034d925**, source/test/count tree **05bdba96708ec66ee9383d26107ec46a92bf12ca**; this report adds documentation only. [Source/binary seal](../../../../tmp/native-git-cwd-20261103/source-seal.json), [summary](../../../../tmp/native-git-cwd-20261103/summary.json), [comparison](../../../../tmp/native-git-cwd-20261103/loc-comparison.json), [exact parent](../../../../tmp/native-git-cwd-20261103/loc-parent.json), [exact staged tree](../../../../tmp/native-git-cwd-20261103/loc-staged.json).

**Production LOC:111783 ->111785 (delta+2).** Core38454 and Engine69620 (daemon9443/Fuse6238) unchanged; API3709→3711, runtime2134→2136, agent900 unchanged. One product file changes its path composition and adds a node:path import; comments/docs/tests do not contribute. Both exact git archive snapshots use the same production_loc.py --root archive --json, SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3. All product Rust/SQL/JS/C++/hpp remain in scope, tests/docs/tools excluded. No migration, test deletion, dependency, unsafe exception or third-party edit. Reference absent (retiredR9c; last counted65417 at tree498dd1917812).

All product binaries remain unchanged: parent24f30149f774a24c2e351cbcf5c1143da9a385e639fd47809967a69f860c4cc2; host6a01e415fa4b26c04d32f15c4965f1ee7160c06dc1a13d322951a711be121426; addon99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a; resident51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e. There is no binary/version fallback or automatic retry after path failure.

Main task3b7a154bc4 remains doing. This slice repairs resident mount topology and qualifies the pinned restricted Git creation/publication/remount path, not the overall pure-Windows objective. No new business-taste judgment; the existing SDK command-shape proposal is still unratified. No DSH/system/profile/Mount Manager or other session work was changed.
