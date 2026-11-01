# ProjFS feasibility probe

> Status: Experimental diagnostic; not a product contract or Workspace implementation.

Four bounded experiments share the same ProjFS callbacks. `live` serves a 96 KiB
fixed sample and exercises local mutations. `store-live` creates a new Disposable
LayerFS Store, pins one published root, and reads directory metadata and binary
ranges through public Persistence/Storage/Content ports. It then advances the
Branch with a separate normal Store call and verifies the projection still reads
the pinned version. Original input is retained at a different path, never used
by callbacks. Roots and failures are retained.

The tool uses existing first-party libraries and windows-sys 0.61.2; registry
versions/checksums in its independent lock match the product lock. ProjFS is
dynamically loaded only from System32, so absent components refuse explicitly.

Build first, then run each test invocation with a wall timeout <=120 seconds:

```powershell
cargo +1.85.1 build --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --target-dir tmp/projfs-probe-target
cargo +1.85.1 test --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --target-dir tmp/projfs-probe-target --no-run
# Run the built test binary under a <=120-second ceiling.
tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe check
tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe live D:/workspace/layerfs/tmp/projfs-proof-<unique>
```

The reproducible CLI smoke covers bad arguments, guarded internal-child mode, API load,
relative-root refusal, existing-root refusal with byte-exact sentinel preservation,
and one fresh live projection. It keeps every receipt and does not delete the roots:

```powershell
node tools/projfs-probe/tests/smoke.mjs tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe tmp/projfs-proof-<unique>
```

Exit 0: the selected probe passed. Exit 2: ProjFS unavailable. Exit 1: failed proof
or invalid input. The live child has a 15-second bound; run the provider itself
under an explicit <=120-second wall timeout too. Never reuse a failed root.

The `live` mode alone proves no Store integration. The `store-live` mode proves
only a pinned read-only Store source for this fixture, not a writable Workspace
or capture-to-Commit. Hydrated/full files live on NTFS; notifications do not
establish a stable Overlay frontier.
No Docker, WSL, Windows feature installation, mount on an existing project, or host
restart is performed. Do not label compilation or unit tests as a live mount PASS.

The explicit unavailable path is implemented via System32-only dynamic loading.
It is not synthetically forced: the final host has ProjFS available, so a missing-DLL
execution is NOT_RUN at that final state. Do not disable the system feature to test it.
The probe uses re-execution of its own binary as an ordinary native child, not a shell
sandbox; it launches no descendants. The separate capture-live counterexample below
checks mapped-write lifetime, not a stable capture implementation.
Notification storage is capped at 1024 only for this bounded diagnostic and overflow fails
the proof. It is not a proposed production cap. The original, renamed and other local
files remain under the test-owned root after stopping the provider.

Toolchain: builds/tests/Clippy use 1.85.1; formatting used the installed default
rustfmt because the 1.85.1 rustfmt component was absent. No toolchain was installed.
The initial overflow test accidentally addressed exact EOF (a legitimate no-op);
it now tests an overflowing length from inside the range and separately asserts EOF.
The original failure is retained in the issue-352 test receipts.

Live result and exact limits: [2026-11-01 probe record](../../core/docs/issues/352/PROJFS-PROBE-2026-11-01.md).

## Real Store read projection

Fixed-source live proof: [Store read result](../../core/docs/issues/352/PROJFS-STORE-READ-2026-11-01.md).

```powershell
tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe store-live D:/workspace/layerfs/tmp/store-projection-<unique>
node tools/projfs-probe/tests/store-smoke.mjs tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe tmp/store-proof-<unique>
```

The source is a read-only SQLite session using explicit Disposable/WAL/OFF.
Opening a pin reads a small metadata root, not zero physical I/O. Before ordinary
file access, directory-list and file-range counters must remain zero. The live
proof checks 80 directory names (crossing the 64-row Content page), nested binary
ranges, a Unicode name and an empty file. It leaves a 2 MiB file unrequested and
unmaterialized. OS read-ahead may hydrate the **entire opened file**: four small
application reads do not imply four small provider reads or a cold-cache claim.

Read-only refers to the Store source, not a security sandbox. Projected existing
file writes/rename/delete are refused, but new local NTFS files are allowed and
retained; the test verifies they do not enter the Store. This is not writeback.
The separately advanced Branch is an ordinary `files::commit` used to challenge
pin stability, never claimed as Commit of projected changes.

Diagnostic limits: up to 1024 entries per listed directory, up to 1 MiB per Content
range read (larger callback demands are chunked), one source mutex, 1024 notification
records. Reaching a bound fails rather than truncates. This slice supports exact
UTF-8 spellings, regular files and directories. Symlinks, unpaired surrogates,
Win32-special names and duplicate ProjFS ordering refuse; case aliasing, hard-link
semantics, GC under concurrent ownership and general repository projection are
not qualified. No root/API/engine files or manifests are changed.

## NTFS capture and mapped-view boundary

The separate `capture-live` mode uses the mutable fixed fixture, not the read-only
Store source. It probes one ordinary file under a new NTFS projection:

```powershell
node tools/projfs-probe/tests/capture-smoke.mjs tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe tmp/capture-proof-<unique>
```

- A read handle with only FILE_SHARE_READ refuses while an external writer or
  writable mapping exists (Win32 32). In the mapping case both the child's File
  and section HANDLE are closed; only its mapped view remains.
- When that handle is acquired with no writer, a new writer in both parent and
  child is refused. The held handle reads the same byte again. This is a bounded
  **per-file** input-admission control, not a namespace capture or active COW.
- A separate permissive read plus LockFileEx does **not** freeze the child's
  writable view. The parent observes the changed byte through its own read-only
  mapped view. File length/mtime and notification counts are observations only.
- PrjStopVirtualizing returns while the child still owns its mapping. A subsequent
  mapped store is visible although no new callback runs. Provider drain is not an
  external-reference fence. The local full file is retained after stop.

There is no FlushViewOfFile, fsync, Durable run, user-process cancellation or
mapping-enumeration heuristic. File-view accesses use raw volatile one-byte
operations within a 4 KiB view; no Rust reference to externally mutable memory is
created. Anonymous section handles are dropped after mapping, and views are
explicitly unmapped with checked outcomes. Only the owned diagnostic child may be
cancelled on failure; all roots and phase markers are retained.
The two-process handshake has a 15-second absolute deadline per participant;
each CLI child has a 30-second bound and the suite uses an explicit <=120s bound.
This is not a performance measurement or power-loss persistence proof.

A successful restrictive open can admit stable bytes for this one known regular
file; it does not freeze directory membership, collect an atomic multi-file
frontier, allow later writes into a new Overlay generation or implement full
repository semantics. **Do not pass permissively opened or post-stop mutable
NTFS files as captured input to Save.** A sharing refusal remains a refusal, not
an automatic wait/retry or a reason to switch to the permissive counterexample.
Workspace capture/Commit remain Unsupported and W2/W3/W4 are not promoted.

## Namespace guard boundary

The separate namespace-live mode retains a read + FILE_SHARE_READ directory
handle and one protected file handle, then launches an ordinary process. The
protected file write and a root-level rename refuse Win32 32. Creating a
subdirectory/file, writing another file, deleting another file and renaming a
nested file still succeed. A directory handle is not a recursive snapshot.

```powershell
node tools/projfs-probe/tests/namespace-smoke.mjs <probe-exe> <fresh-output-directory>
```

The first diagnostic expected the root rename to succeed and failed; its root
and output are retained. The corrected test asserts the exact observed operations,
not a universal claim about every rename path or Windows version. It does not
implement multi-file capture, mutation generations or Commit. See the
[native request-path result and next step](../../core/docs/issues/352/WINDOWS-NATIVE-REQUEST-PATH-2026-11-01.md).

## WinFsp -> real Rust Workspace/Overlay bridge

The diagnostic library is now named layerfs_native_probe (rlib + cdylib), keeping
its PDB name distinct from the existing layerfs-projfs-probe CLI on Windows.
Existing ProjFS CLI modes are unchanged. The first-party dependencies are the
already locked layerfs-workspace and layerfs-overlay crates, not a new database
or filesystem encoder. Root manifests/lock and product sources are unchanged.

The C++ native host in ../winfsp-probe.cpp now delegates its state to this Rust
library: one real Disposable Store fixture, one bound Workspace and the existing
MEMORY/OFF/EXCLUSIVE Overlay owner. No C++ file-content array remains. The bridge
uses public StoreService/BoundWorkspace, Mutation and native kernel read/open/close
ports. File identities and serial ranges come from those ports, never a local
inode counter. FFI request tokens are not inode identities.

Build this library/CLI as above, then the native host using ../winfsp-build.ps1.
Run (from repository root) under a <=120-second ceiling:

```powershell
node tools/winfsp-smoke.mjs <native-host-exe> <installed-WinFsp-dll> <target>/debug/layerfs_native_probe.dll <target>/debug/layerfs-projfs-probe.exe <fresh-output>
```

The ordinary Windows process reads an existing Store file, writes/reads 300KB
through bounded Overlay windows, truncates, renames, deletes and recreates with a
new inode. A descriptor remains open across capture; after a later write the live
file changes while the retained captured reader still yields the old bytes.
The first write is closed before capture so the test does not pretend dirty kernel
cache bytes have already been published. Cleanup keeps descriptor ownership;
Close releases its exact OpenFile/KernelDirectory and lookup reference.
The direct Rust integration test additionally reads/writes an unlinked open file.

This is a non-shipped integration slice, not the product Workspace API. Only exact
UTF-8 root entries are admitted; nested path operations, new directories, links,
complete Windows metadata/security changes, concurrent callbacks/capture and
mapped writes remain unqualified. A diagnostic bridge mutex serializes requests
and control (never the product SQL lock across Store I/O); replace this admission
before production. The existing Mutation reply-attempt boundary is reused; full
native callback reply/capture ordering is not claimed by the sequential proof.
Unknown owner errors latch refusal and retain custody instead of cleanup/replay.

The independent diagnostic capture is explicitly released/resolved with no history
publication. Then commit_captured takes its own new capture and runs the existing
CapturedNamespace -> Save::finish -> History -> local install. Two real Commits are
read back by History id while native descriptors stay open across publication;
a later write and a new file appear only in the second immutable snapshot. An
unchanged third call must return UpToDate without adding a Commit. After the
provider exits, the supplied checker process reopens the Store read-only and
checks both versions' exact sizes/bytes, parent relation, via=Workspace, head and
unchanged base directory membership. This is a read-only Store reopen, not a
second native mount or a power-loss proof.

No fs.apply, re-Init after mutation, native-tree scan/copy, manual SQL or alternate
content encoding is used. A failed Commit retains its exact original failure;
a failed post-publication audit retains the known success receipt too. The host
never retries an uncertain publication. Product Workspace API, concurrent Commit,
mapped writes and full-repository qualification remain NOT_RUN.
