# Native route verification

This directory is the LayerFS native-route verifier package, not product code.
Root LayerFS rules apply. Preserve prior material/spec/run/archive identities.
Only inspect fresh isolated Stores; no real host, credentials, workflow triggers or feature enabling.
Store checks and Workspace readiness are separate leaves. A Store PASS never authorizes
Workspace, upstream merge, production deployment or a DACL change.
Scripts live under tools/, material/candidate/review inputs under materials/.
Outputs go to a new task directory outside this verifier package.
All child test invocations are bounded to 120 seconds or less.
