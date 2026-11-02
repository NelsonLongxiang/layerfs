# Native Windows explicit force Commit（2026-11-03）

> **Status:** Dated implementation and scoped functional evidence. Explicit SDK force publication, captured-parent/displaced-head provenance, clean-merge contrast and original admission/custody pass. Not forced unmount, arbitrary conflicting merges, kernel/mapping drain, recovery or release qualification.

## Implemented policy

The bound native SDK now accepts workspace.commit(ws,message,force=false). The [public call](../../../../api/agent/src/workspace/commit.js) rejects non-boolean force before invoking any binding. The [native client](../../../../api/runtime/src/platform/native-windows/client.js) and [original Session](../../../../api/runtime/src/platform/native-windows/session.js) independently validate the selected boolean; undefined means false, while null/numbers/strings/objects are InvalidInput. No truthy coercion is used.

A Session's optional fourth Commit argument and the existing inherited [control command](../../../../engine/crates/layerfs-daemon/src/native/control_commit.rs) carry canonical force true/false. Old commands without the suffix remain false. The existing8320-byte control record remains sufficient for the4096-byte message plus command/force overhead; no new window or multipart owner is added.

[CommitWork and completion](../../../../engine/crates/layerfs-daemon/src/native/commit.rs) retain the original CommitOptions, including force and message, and pass them unchanged to the existing Store constructor. Force does not bypass Published scope, native failure fencing, namespace/close coordination, pending Commit/capture or the existing publication lane. The native receipt checks the original parent/merge provenance and agreement between displaced outcome and record metadata; a forced result must not masquerade as a merge. Unknown outcomes retain original options/completion without replay.

No merge/overwrite algorithm, Store RPC, second encoder, owner registry, token/ACL or native teardown path is introduced. The [existing Store policy](../../../../engine/crates/layerfs-store-service/src/store/commit.rs) and [History publication](../../../../engine/crates/layerfs-persistence/src/history/commit.rs) remain byte-identical to the parent. A force Commit is **not forceUnmount**. [SDK contract](../../../../api/docs/agent.md), [native contract](../../../../api/docs/runtime.md#bind-an-existing-sdk-client-to-a-running-native-instance), [architecture](../../architecture/68-native-workspace-control.md).

## Actual original restricted SDK comparison

The [small real consumer](../../../../api/runtime/test/verify/native_commit_force_real.mjs) initializes a fresh explicit Disposable/WAL/OFF Store and seed Commit, creates one original restricted resident, and mounts two Workspaces of each selected Branch before publishing either one. It uses ordinary file writes and the public SDK Commit; command registration is not required for filesystem access.

[Original result](../../../../tmp/native-commit-force-20261103/actual-first/result.json), read **2026-11-02T22:30:27.427Z** (2026-11-03 06:30:27 Asia/Shanghai), [invocation](../../../../tmp/native-commit-force-20261103/actual-first-command.json), [original cases/History](../../../../tmp/native-commit-force-20261103/actual-first/cases.json), [audit](../../../../tmp/native-commit-force-20261103/audit-command.json):

- Seed parent:12e40b8fe094b9eba879ea6ac61e657b3a0657f9bad5759d490b58a4c9faee22c5. Both Workspaces bind that original head. Six invalid boolean inputs refuse before effects, with original native status unchanged.
- **Normal clean merge:** Workspace A publishes a head-only path. Workspace B then publishes its different local path/common-file change with force:false. The Store merges both sides, B installs the merged view, parent is A's publication, displacedHead is null and merged identifies the original seed/A heads. Both paths survive Store readback and a fresh mount.
- **Explicit overwrite:** the same head movement with force:true publishes B's own complete view without merging A's head-only path. Parent remains B's original seed, displacedHead is A's publication and merged is null. A's path is absent from the new Branch root, but the displaced immutable Commit stays readable by ID. Local paths/content survive the new publication and remount.
- **Unchanged stale view:** B has no local dirty inode/entry, while A has published an intervening path. An explicit force Commit can intentionally restore B's old complete root; the receipt reports changed:true, the captured seed parent and the displaced A head. A following force at that same current root is UpToDate, not another metadata/flag-only publication.

| Case | Original result head | Parent policy | Displaced head |
| --- | --- | --- | --- |
|Normal merge|12f63e0ec46395eaef064964c961a52c5abd62ac08ddecbf5d7a9102c591a15ce1|new head from A|null|
|Force overwrite|12b81ab2da57a1a1178ec5bff9085fde97a097a911523deca7c55e0ca2c9723bf6|original seed|1271dac314adc750382b8d98a874ed50011897f722ed229fb0ff0b49d13c7eb100|
|Force unchanged stale root|12b6da534f400bb7568fc3ab5ba5f6bd61b21d0aba1cf301dd8a8464d6d45a6ea2|original seed|12e6108a93ee528ad48d4bd5f088372d0377bbda12b117a37da87e1e34bd60c8a3|

Each original receipt is matched to independent SDK History message/parent/base/root/displaced fields. The normal merged parent chain has3reachable rows; each overwrite chain has2reachable rows because it deliberately retains the old captured parent. The displaced record is not deleted. Three following forced UpToDate calls preserve head/root and History. A separate [post-close ordinary SDK readback](../../../../tmp/native-commit-force-20261103/post-close-readback.json) verifies final Branch contents, identical History and readable displaced Commit paths without remount, publication or replay.

All eight original Workspace normal unmounts complete with native/parent exit0 and overlayClosed:true. The original resident PID81028 stays live until the final checked tokenClosed/desktopClosed/processExit0 receipt; runtime_closed:true, sessions/instances empty. No force unmount, caller kill, auto retry or prior-owner recovery is used.

## Admission and protocol checks

[Direct product tests](../../../../tools/projfs-probe/tests/product_native_session.rs) pass **12/12**,0ignored. The new force policy test covers both merge/overwrite and rejects ApplicationVisible capture, active coordination and a second pending Commit before effects. The existing native-failure test now exercises both force values: a publicly observed revoked-mount failure retains the original completion, pending Commit and backing; neither a later false nor true request can bypass that custody. This is not a new recovery API or a product test hook. [Final test receipt](../../../../tmp/native-commit-force-20261103/public-session-final-command.json).

Seven Session protocol scenarios cover exact message/force encoding, invalid boolean types, original InvalidInput refusal, foreign reply and EOF without replay. [Force EOF check](../../../../tmp/native-commit-force-20261103/protocol-force-eof.json), [SDK forwarding](../../../../tmp/native-commit-force-20261103/forwarding-command.json), [public packaging validation](../../../../tmp/native-commit-force-20261103/packaging-command.json), [39 shared SDK call cases](../../../../tmp/native-commit-force-20261103/sdk-calls-command.json) and three original-owner regressions pass.

The [raw inherited control consumer](../../../../api/runtime/test/verify/native_commit_message_wire.mjs) independently rejects13bad metadata/force records, preserving native state, and accepts9clean UpToDate records spanning legacy, explicit false and explicit true with empty/default/4096-byte messages. Its original terminal completes normally. [Wire result](../../../../tmp/native-commit-force-20261103/wire-corrected/result.json). Message Unicode/empty/default/bound semantics separately retain their5publication/5UpToDate [actual SDK regression](../../../../tmp/native-commit-force-20261103/metadata-regression/result.json).

Rust1.85.1 offline/locked product build, lib/native-bin no-run, external public-test no-run and scoped warning-denying Clippy pass. Root/probe fmt, Node syntax,1017-file boundary scan,37guard and23counter self-tests pass. [Checks](../../../../tmp/native-commit-force-20261103/guards-final.json), [product build](../../../../tmp/native-commit-force-20261103/build-first.json), [public-test build](../../../../tmp/native-commit-force-20261103/custody-test-build.json), [lib/bin no-run](../../../../tmp/native-commit-force-20261103/lib-bin-build.json). No lib/bin no-run is counted as an additional functional test. All actual tests have explicit foreground wall limits≤120seconds; long jobs are build/count only and collected. Existing Windows all-targets Unix-only limitations are not hidden as global green.

## Preserved failed checks and limits

- External test compilation initially failed E0277 because unwrap_err requires the successful Stat type to implement Debug. No test executed. The external assertion now extracts err().unwrap(); no product Debug implementation or assertion weakening was added. [Failed build status](../../../../tmp/native-commit-force-20261103/public-test-build-failed.json) and [corrected build](../../../../tmp/native-commit-force-20261103/public-test-corrected-build.json) are retained. The diagnostic text was already read in-session before the final incremental job collection.
- The first wire selection used the new force fixture, which has merge/overwrite/stale-clean Branches but no feature Branch. Its original startup reports MissingBranch, no RootServed and no Commit requests. [Failed wire result](../../../../tmp/native-commit-force-20261103/wire/result.json) remains FAIL. Corrected wire input selects a previously normally closed fixture containing feature; the same readiness limit is kept, with no retry of the original failed operation.
- Sequential paired Workspaces do not qualify every same-path conflict, base-Layer change or publication-lane interleaving. The original Store remains the authority for such outcomes; force does not authorize loss of unknown custody or skipped capture/namespace checks.
- Overwrite intentionally changes the current Branch view, including removal of intervening-only paths. Its displaced metadata and historical readability are checked, not inferred. No external release, deploy, merge or real user Store is involved.
- Historical Git13/8/cwd/control/verifier FAIL artifacts remain unchanged. Named IPC, Bash/OCI, arbitrary kernel/mapping drain, full host/network/registry isolation, crash recovery, discovery/installation and signed release are not qualified by this publication-policy proof. Forced unmount stays Unsupported.

## Exact source and production LOC

First parent **fa740e44fd0cb792e23e9cbe0f7eed6216892f22**, source/test/count tree **ffac2eb4900db4d5227dd7db5758dcab2ce6fcfc**; this report adds documentation only. [Source/binary seal](../../../../tmp/native-commit-force-20261103/source-seal.json), [summary](../../../../tmp/native-commit-force-20261103/summary.json), [raw audit](../../../../tmp/native-commit-force-20261103/audit-command.json).

Parent binary SHA256 **baef93d8fbf385e854cf1940401d6c49d40c09753c44c57fd6b8963793dd741d**; existing host6a01e415fa4b26c04d32f15c4965f1ee7160c06dc1a13d322951a711be121426, addon99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a and resident51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e are unchanged. There is no old-service fallback or C++/token/ACL/system change.

**Production LOC:111872 ->111912 (delta+40).** Core38454 unchanged; Engine69697→69729, daemon9520→9552(+32), Fuse6238 unchanged; API3721→3729, runtime2146→2152(+6), agent900→902(+2). [Exact comparison](../../../../tmp/native-commit-force-20261103/loc-comparison.json), [parent](../../../../tmp/native-commit-force-20261103/loc-parent.json), [staged tree](../../../../tmp/native-commit-force-20261103/loc-staged.json).

Both exact git archive snapshots use the same production_loc.py --root archive --json, SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3. Product Rust/SQL/JS/C++/hpp remain included; tests/docs/tools excluded. No migrations, dependencies, third-party patch, unsafe exception or deleted tests. Reference absent (retiredR9c; last counted65417 at tree498dd1917812).

Main task3b7a154bc4 remains doing; explicit force publication is complete at this scope, not the whole pure-Windows product. No new business-taste judgment, and the existing SDK shape proposal remains unratified. No DSH checkout/profile/system or other session work changed.
