# ProjFS feasibility probe

> Status: Experimental diagnostic; not a product contract or Workspace implementation.

An isolated, single-file projection serves 96 KiB of deterministic bytes on demand.
A separately spawned native process enumerates, reads, writes, renames and deletes
inside a fresh directory. The provider records notification counts and drains
callbacks before releasing its state. Roots are always retained, including failures.
The tool uses only the already-pinned windows-sys dependency and dynamically loads
ProjectedFSLib from System32, so absent ProjFS produces an explicit refusal.

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

This proves neither LayerFS Store integration nor capture-to-Commit. Hydrated/full
files live on NTFS and notifications alone cannot establish a stable capture frontier.
No Docker, WSL, Windows feature installation, mount on an existing project, or host
restart is performed. Do not label compilation or unit tests as a live mount PASS.

The explicit unavailable path is implemented via System32-only dynamic loading.
It is not synthetically forced: the final host has ProjFS available, so a missing-DLL
execution is NOT_RUN at that final state. Do not disable the system feature to test it.
The probe uses re-execution of its own binary as an ordinary native child, not a shell
sandbox; it launches no descendants and tests no mapped-write or concurrent-capture guarantee.
Notification storage is capped at 1024 only for this bounded diagnostic and overflow fails
the proof. It is not a proposed production cap. The original, renamed and other local
files remain under the test-owned root after stopping the provider.

Toolchain: builds/tests/Clippy use 1.85.1; formatting used the installed default
rustfmt because the 1.85.1 rustfmt component was absent. No toolchain was installed.
The initial overflow test accidentally addressed exact EOF (a legitimate no-op);
it now tests an overflowing length from inside the range and separately asserts EOF.
The original failure is retained in the issue-352 test receipts.
