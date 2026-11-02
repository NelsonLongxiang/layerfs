# Windows native Git publication/remount roundtrip（2026-11-03）

> **Status:** Dated scoped functional verification record. Trusted-local native Git state, two publications/remounts and three direct normal unmounts pass. Not restricted SDK Git, arbitrary mapping/kernel drain or release qualification.

## Result and execution scope

**PASS — focused trusted-local native roundtrip.** The [new consumer](../../../../api/runtime/test/verify/native_git_roundtrip_real.mjs) makes 16 mounted Git calls, two explicit LayerFS Published Commits, two byte-exact remount comparisons and three direct clean unmounts. Each unmount is sent once after recording original reference facts, without waiting for handles0 in the test. The third mount actually has four outstanding references, including the Git index, before its successful original terminal.

[Original result](../../../../tmp/native-git-roundtrip-20261103/actual-first/result.json), read **2026-11-02T20:14:46.466Z** (2026-11-03 04:14:46 Asia/Shanghai); [command receipt](../../../../tmp/native-git-roundtrip-20261103/actual-first-command.json), [summary](../../../../tmp/native-git-roundtrip-20261103/summary.json), [raw-artifact audit](../../../../tmp/native-git-roundtrip-20261103/audit-command.json).

This is an independent input for the product close path implemented by 9e5a28d50, not a replay of the old35-command workload or a replacement verdict for its historical FAIL. It explicitly uses public runtime.native.open/Session.exec/commit/unmount, while actual SDK Init, fs reads and History independently consume the Store. No restricted-mode failure is retried through this route. Restricted Git cwd normalization remains FAIL/NOT_QUALIFIED.

## Prepared input and unchanged product

The consumer copies the closed small Git fixture from the [prior successful native-close source](../../../../tmp/native-coordination-20261103/git-sealed/source/repo/.git/HEAD) into a fresh independent writable source. [Prepared-before](../../../../tmp/native-git-roundtrip-20261103/actual-first/prepared-before.json) and [prepared-after](../../../../tmp/native-git-roundtrip-20261103/actual-first/prepared-after.json) agree exactly; each original file and cloned byte is reconciled by the audit. Clone reuse is setup reuse, not a cold-cache or performance claim. It does not reuse the old mutated failing mount, Store or runtime home.

The fixture already has Git commit3ae598d6761a35dc6d31fe49f85322a3b8b830ef. SDK Init imports the complete copied source, including hidden Git metadata and its index. All subsequent mounts bind that complete root through the product Session; the verification manifest is only an external observer, not the implementation of mount, Commit or remount. Every new Store follows the existing explicit Disposable/WAL/OFF Init route; per-mount overlays remain MEMORY/OFF/EXCLUSIVE.

Only a new test and evidence documentation are added. Product Rust/JavaScript/C++/hpp, dependencies, token/ACL policy and binaries are unchanged from parent9e5a28d50efd9c07d71f4d9f87ca4952279e3de3. No build, Rust/Clippy, kernel driver, Store schema, dependency, unsafe exception, system/profile/DSH change or new protocol is needed for this test-only slice. Existing unaffected product/active-view/SDK regression receipts retain their original identities rather than being rerun.

## Complete mutable state across publication1

The first mounted view creates an ignore rule, a300023-byte deterministic ignored binary, a staged file and an untracked file. Git add stages the first content, then the ordinary file write changes its working bytes again. Git status is exactly:

~~~text
A  .gitignore
AM staged.txt
?? untracked.txt
~~~

Git show :staged.txt reads staged index content plus newline, while the file contains unstaged working content plus newline. Git check-ignore confirms ignored/cache.bin is ignored; Git show HEAD:seed.txt verifies the prepared history. Before the explicit LayerFS publication, SDK Store fs.read of the new working path is NoSuchPath and SDK History is empty. The test does not treat a Git command as an implicit LayerFS Commit.

After the first explicit Published Commit and normal unmount, the fresh mount's [44-entry/19-file manifest](../../../../tmp/native-git-roundtrip-20261103/actual-first/after-first.json) equals the [prepublication complete view](../../../../tmp/native-git-roundtrip-20261103/actual-first/before-first.json), including directories, .git/index, Git objects/refs, working bytes, ignored binary and untracked data. Each file records its length and SHA256. SDK fs.read sees the published working content, but Git show :staged.txt still reads the different staged content. Git status is unchanged. Ignore rules never filter LayerFS state.

## Publication2, independent History and remount2

The second mount adds the current working state and creates exactly one new Git commit, **c50496ee2c571c6345753cd5fedb82c412213cbc**, whose parent is the prepared commit. Git status becomes empty and HEAD:staged.txt contains the former unstaged content. This is a second Git commit in the fixture's history, not three new Git commits as in the older workload.

The two original LayerFS publication receipts are:

| Publication | Original head | Parent |
| --- | --- | --- |
|1|1242b447afec54e4b754d29f3ab9ea8ce39eaa1c544f7b49ec846dfb386c66a002|null|
|2|12ad2bbcfae06785dd6ca8045cb4126c1979032acdbc3a7a11af233ab15f3f45e9|publication1|

[Original publication receipts](../../../../tmp/native-git-roundtrip-20261103/actual-first/publications.json) are checked against exactly two [independent SDK History rows](../../../../tmp/native-git-roundtrip-20261103/actual-first/history.json), including their parent/base/root identities; no latest-History query is used to infer an earlier native receipt.

After the second explicit publication and normal unmount, the [52-entry/23-file remount manifest](../../../../tmp/native-git-roundtrip-20261103/actual-first/after-second.json) equals the [second complete view](../../../../tmp/native-git-roundtrip-20261103/actual-first/before-second.json). The ignored binary remains exact. The final mount's Git HEAD file, index read and clean status all agree. No .git/index.lock exists in either complete-view manifest. All16 Git calls preserve original root exit0 and finished/consumed stdout/stderr EOF, with restricted:false and cancellationRequested:false.

## Three original normal terminals, no zero-handle preflight

[Close observations](../../../../tmp/native-git-roundtrip-20261103/actual-first/close-observations.json) are read once per mount, followed by one explicit clean unmount. There is no test-side drain wait, extra Commit, retry, force, process kill or Cleanup-as-Close shortcut. The observations are not a pinned snapshot; the original unmount owner decides admission and completion.

| Mount | Native handles immediately observed | Active/dirty | Original terminal |
| --- | --- | --- | --- |
|1|0|0/0|nativeExit0, overlayClosed:true, parent exit0|
|2|0|0/0|same|
|3|4|0/0|same|

The third observation includes original handle613 for /repo/.git/index and handles545/630/631 for three .git/objects files. Each is a cleaned regular-file lookup owner without data-write, attribute-write or delete access. These are facts of this new mount only, not retroactive identities of the historical13/8-reference failures. The product's existing cache-reference coordinator processes them; the test does not manually evict or release them.

[All three correlated terminal receipts](../../../../tmp/native-git-roundtrip-20261103/actual-first/terminals.json) require nativeExit0, overlayClosed:true, processExit0 and processSignal:null. Raw dispatcherc0000120 is accepted only through the already-qualified healthy explicit stop rule. Final runtime_closed:true and sessions/instances are empty. [Observation totals](../../../../tmp/native-git-roundtrip-20261103/actual-first/observations.json) record exactly3unmount attempts and3terminals, testSideHandleDrainWait:false.

## Verification and preserved limits

The consumer passed Node syntax checking before execution and ran once under an explicit90-second foreground wall limit. No new failure or functional rerun occurred in this slice. The bounded fixture audit verifies all16 command artifacts and output hashes, both complete manifests, unchanged prepared source, original publications, History parents/roots, three normal terminal receipts and current binary hashes. No timing/throughput/cold/peak claim is made from these functional receipts.

Product binary SHA256 identities:

- parent:24f30149f774a24c2e351cbcf5c1143da9a385e639fd47809967a69f860c4cc2.
- host:6a01e415fa4b26c04d32f15c4965f1ee7160c06dc1a13d322951a711be121426.
- addon:99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a.
- WinFsp:94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3.
- Git cmd entry:851535ccc041bed536a23b17200cd51e7b06e266a527f4eaf8338b5c256c6466; not an attestation of every Git dependency.

[Source/binary seal](../../../../tmp/native-git-roundtrip-20261103/source-seal.json) pins the exact consumer and unchanged product. The [old Git result](../../../../tmp/native-sdk-git-20261103/trusted-first/result.json) remains FAIL with13references and runtime open; [old8-reference qualification](../../../../tmp/native-git-close-20261102/file-trace/data-checkpoint.json) remains false. This successful new input does not reopen/recover their original owners or change the retained verifier7PASS/2FAIL. Restricted Git still fails before init because its DOS cwd normalization is unresolved. Arbitrary mappings/kernel references, crash recovery, full host confinement, OCI/Bash and installation/release remain outside this proof. No Mount Manager, token/ancestor ACL widening, worker fallback or third-party patch was used.

## Exact production LOC

First parent **9e5a28d50efd9c07d71f4d9f87ca4952279e3de3**, counted/source-sealed tree **f4d9afc9b7e5b3179cbb73bc018aaf7efb8c2cfa**; this report adds documentation only. **Production LOC:111783 ->111783 (delta+0).** Core38454, Engine69620 (daemon9443/Fuse6238), API3709 (runtime2134/agent900) unchanged. All product src blobs are identical; new test/docs are excluded, required runtime JS/C++/hpp remain included.

[Comparison](../../../../tmp/native-git-roundtrip-20261103/loc-comparison.json), [exact parent count](../../../../tmp/native-git-roundtrip-20261103/loc-parent.json), [exact staged count](../../../../tmp/native-git-roundtrip-20261103/loc-staged.json): both git archive trees use the same production_loc.py --root archive --json, SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3. No migrations, test deletions, dependencies or unsafe exceptions. Reference absent (retiredR9c; last counted65417 at tree498dd1917812).

Main task3b7a154bc4 continuesdoing. This slice completes the focused trusted-local multi-publication close proof, not the pure-Windows objective as a whole. No new business-taste judgment; the existing SDK shape proposal is still unratified.
