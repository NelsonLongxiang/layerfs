# Restricted Windows SDK Git full-state roundtrip（2026-11-03）

> **Status:** Dated scoped functional verification record. One original restricted resident, complete Git staged/working/index/ignored state, two SDK publications/remounts and three normal Workspace terminals pass. Not arbitrary Git/kernel/mapping, OCI/Bash, recovery or release qualification.

## Result and selected route

**PASS — scoped restricted SDK roundtrip.** The [existing focused consumer](../../../../api/runtime/test/verify/native_git_roundtrip_real.mjs) now has an explicit restricted-sdk selection, using the original runtime.native.create/bindClient instance and SDK workspace.mount/exec/commit/unmount. Default trusted-local behavior remains a separate selected input. There is no error-driven switch, plain-token fallback, second mount registry or new product transport.

[Successful original result](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/result.json), read **2026-11-02T21:13:17.010Z** (2026-11-03 05:13:17 Asia/Shanghai); [execution receipt](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected-command.json), [summary](../../../../tmp/native-sdk-git-roundtrip-20261103/summary.json), [raw-artifact audit](../../../../tmp/native-sdk-git-roundtrip-20261103/audit-command.json).

All16 mounted Git calls report restricted:true, original root and finished exit0, consumed stdout/stderr EOF and cancellationRequested:false. Every publication and unmount passes through the bound SDK, not direct Session commit/unmount. Original native state is read through backend.daemon.workspace.status and correlated with the original process-local runtime owner. The SDK route exposes counts, not a per-reference listing; this proof records rows:null rather than inventing identities from earlier direct consumers.

## Prepared input and complete mutable state

The consumer independently clones the closed [prepared source](../../../../tmp/native-coordination-20261103/git-sealed/source/repo/.git/HEAD) used by the earlier trusted-local proof. [Prepared-before](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/prepared-before.json) and [prepared-after](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/prepared-after.json) match exactly, and the audit reconciles every original and cloned file. This is setup reuse, not reuse of a mutated mount, a cold-cache claim or a timing sample.

Actual SDK Init/fork creates a fresh explicit Disposable/WAL/OFF Store and Branch. The initial Git commit is3ae598d6761a35dc6d31fe49f85322a3b8b830ef; the mounted commands create one further Git commit, c50496ee2c571c6345753cd5fedb82c412213cbc, with that parent. Git history is distinct from the two explicit LayerFS publications.

Before publication1, Git index holds staged index content plus newline, while the working file holds unstaged working content plus newline. Git status is exactly:

~~~text
A  .gitignore
AM staged.txt
?? untracked.txt
~~~

The ignored file is a300023-byte deterministic binary, independently checked by length and SHA256. Untracked data remains part of LayerFS state. Before the explicit LayerFS Commit, SDK fs.read of the new file is NoSuchPath and History is empty; Git calls do not implicitly publish LayerFS state.

[First complete view](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/before-first.json) and [first remount](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/after-first.json) are identical: **44entries,19files**, including directories, hidden Git metadata, index, objects/refs, ignored binary, untracked file and working bytes. On the fresh mount, SDK reads the published working content while Git show :staged.txt still reads the distinct staged version and status remains the same.

The second mount adds/commits the current Git working state. [Second complete view](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/before-second.json) and [second remount](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/after-second.json) are identical: **52entries,23files**. Git HEAD and index now both contain the former working content, status is clean, and the ignored binary remains exact. No index.lock exists in either complete manifest. Manifests are external verification observations, not an export/materialization implementation of mount or Commit.

## Original publications and independent SDK History

The [original SDK publication receipts](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/publications.json) are:

| Publication | Original head | Parent |
| --- | --- | --- |
|1|120db5f4800c8a376e560a5efa42bc21fd3d708e38f9664a68cab3179c09790cb0|null|
|2|122ce26e7cc645f447bb885d301884a1999f27de484580300a5e90caa6c622ef9f|publication1|

Both are kind:Committed, mode:windows-restricted and scope:published. Exactly two [independent SDK History rows](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/history.json) agree with head, parent, base and root. No latest-History lookup is used to guess an earlier receipt. This proof does not change or qualify custom Commit messages/force or application-visible mapping capture.

## Three normal Workspace terminals and one original resident

Each mount records original native state and sends **one SDK normal unmount**, with no test-side handles0 wait, retry, force, extra Commit, caller-process kill or automatic mapping release. [Close observations](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/close-observations.json) report handles0,0,4 respectively, all active0/dirty0. The final four references are only a count in this SDK read model; their file paths/section origins are not enumerated or inferred.

[All three correlated Workspace terminals](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/terminals.json) report Unmounted/windows-restricted, nativeExit0, overlayClosed:true, processExit0 and processSignal:null. The healthy explicit-stop dispatcher code retains its existing interpretation. Final mounted lists are empty.

[Resident observations](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/resident.json) keep the same original instance ID and PID83164 at creation, before each of the three mounts and before close. Three distinct original Workspace IDs match backend state and process-local ownership, without storing a second owner map. Only after all mounts end does SDK sandbox.close obtain the original checked tokenClosed:true, desktopClosed:true and processExit0 receipt. Final runtime_closed:true, sessions:[] and instances:[]. These are functional lifecycle receipts, not proof of every descendant/kernel object or crash recovery.

The [original SDK trace](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-corrected/sdk-trace.jsonl) correlates3mounts,16explicit native exec starts,2Committed calls,3Unmounted calls and1Closed call with the raw receipts. Exec trace records only mode/argv count and started/command ID; actual completion comes from original command receipts, never from a trace “started” event. Arguments/environment contents are not retroactively added to the trace.

## Consumer-contract failure preserved

The [first run](../../../../tmp/native-sdk-git-roundtrip-20261103/actual-first/result.json) remains **FAIL**, read21:12:19.937Z. The consumer incorrectly expected a workspace identity field on the public SDK mount return. The [actual mount contract](../../../../api/agent/src/workspace/mount.js) returns sandbox/path/image/mode; identity belongs to the backend native state and original runtime owner observation.

That run completed five Git commands and publication1 but failed its assertion before sending the first unmount; it has no terminal receipt and runtime_closed:false, with its original Session still serving. No force cleanup, process kill, re-adoption or claim of normal completion is made for this failed input.

The consumer was corrected to correlate backend state with the original runtime owner at the returned path, asserting its instance and restricted policy. This does not weaken the identity condition or change product code. A fresh independent clone/home/output, actual-corrected, then exercises the complete path. The first failure and corrected success are not the same sample, and neither is relabeled as the other.

## Warnings, checks and preserved limits

Eight command records retain stderr warnings that the restricted token cannot read the user's .config/git/ignore. All16 exit codes and exact expected contents/status/manifests are checked independently. No user/profile/global Git config was edited, access widened, warning suppressed or workload re-executed simply to obtain empty stderr.

Node syntax checking precedes each run. Each functional invocation is a foreground100-second-bounded command, not a background test; the successful chain did not reach that limit. Only tests/docs change, so unchanged Rust/C++ build, Clippy, product guards and prior seven mount-owner/backend-denial scenarios are **NOT_RUN this slice** and retain their own original identity. No test deletion, dependency, unsafe exception, third-party patch, source migration, product encoder/transport, token/ACL or system configuration change is introduced.

Product hashes remain parent24f30149f774a24c2e351cbcf5c1143da9a385e639fd47809967a69f860c4cc2, host6a01e415fa4b26c04d32f15c4965f1ee7160c06dc1a13d322951a711be121426, addon99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a and original resident51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e. [Source/binary seal](../../../../tmp/native-sdk-git-roundtrip-20261103/source-seal.json) is separate from these functional receipts; no signed build/distribution is claimed.

This qualifies the pinned focused restricted SDK Git workload, not all Git options/configuration/symlink behavior. DOS final-volume naming still returns1005, and a caller-selected inaccessible ancestor can still prevent long-path normalization; the [cwd topology limits](WINDOWS-NATIVE-GIT-CWD-2026-11-03.md) remain. Named IPC remains unsupported. Arbitrary mappings/kernel references, full host confinement, OCI/Bash, forced unmount, crash recovery and installation/release are not qualified here.

[Historical13-reference FAIL](../../../../tmp/native-sdk-git-20261103/trusted-first/result.json), [old8-reference qualification](../../../../tmp/native-git-close-20261102/file-trace/data-checkpoint.json), original cwd128FAIL and retained verifier7PASS/2FAIL stay unchanged. This successful new restricted workload does not recover their original owners or supply retroactive reference identities.

## Exact production LOC

First parent **5f37dc25f979efa452d4998e9f7eb35273281349**, counted/test/source-sealed tree **8df1ac652ca6129ad1ecf77f08bf9c71efe794b0**; this report adds documentation only. **Production LOC:111785 ->111785 (delta+0)**. Core38454, Engine69620 (daemon9443/Fuse6238), API3711 (runtime2136/agent900) unchanged. All product src blobs match the first parent.

[Exact comparison](../../../../tmp/native-sdk-git-roundtrip-20261103/loc-comparison.json), [parent](../../../../tmp/native-sdk-git-roundtrip-20261103/loc-parent.json), [staged tree](../../../../tmp/native-sdk-git-roundtrip-20261103/loc-staged.json): both git archive snapshots use the same production_loc.py --root archive --json, SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3. Required first-party runtime SQL/JS/C++/hpp remain included; tests/docs/tools are excluded. Reference absent (retiredR9c; last counted65417 at tree498dd1917812).

Main task3b7a154bc4 remains doing. This slice completes the focused restricted resident SDK Git state/publication/remount/normal-close proof, not the entire pure-Windows product objective. No new business-taste judgment; the existing SDK shape proposal is still unratified. No DSH checkout, profile or other session work was modified.
