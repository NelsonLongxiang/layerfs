# ProjFS feasibility probe

This is an independent, non-shipped diagnostic, not a LayerFS Workspace/Sandbox
implementation. Root repository rules apply. Reuse pinned windows-sys 0.61.2;
never modify registry dependencies, root manifests, the product addon or DSH.
Unsafe code is restricted to src/windows, justified at each FFI boundary.
Only fresh caller-named absolute roots may be used; existing paths are refused.
Do not auto-enable Windows features, elevate, restart, or delete a projection root.
Keep all live artifacts on failure. A successful probe never implies stable
Overlay capture, Commit, sandbox isolation or product readiness.
