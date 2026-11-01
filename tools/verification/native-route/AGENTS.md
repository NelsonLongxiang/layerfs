# Native route verification

This directory is the LayerFS native-route verifier package, not product code.
Root LayerFS rules apply. Preserve prior material/spec/run/archive identities.
Only inspect fresh isolated Stores; no real host, credentials, workflow triggers or feature enabling.
Store checks, read-only projection evidence and Workspace readiness are separate leaves.
Neither Store nor projection PASS authorizes Workspace, upstream merge, production
deployment or a DACL change. Retained evidence imports preserve original source/time;
run the raw-artifact audit before verification and after archive snapshot extraction.
Scripts live under tools/, material/candidate/review inputs under materials/.
Outputs go to a new task directory outside this verifier package.
All child test invocations are bounded to 120 seconds or less.
