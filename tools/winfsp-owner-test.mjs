// Direct owner failures, including an actual mounted root identity mismatch.
// node tools/winfsp-owner-test.mjs <owner-tests> <host> <WinFsp> <bridge> <fresh-output>
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const [owner,host,winfsp,bridge,output]=process.argv.slice(2).map(p=>resolve(p));
assert.ok(owner&&host&&winfsp&&bridge&&output);
assert.equal(existsSync(output),false);mkdirSync(output,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const run=(exe,args,name)=>{const r=spawnSync(exe,args,{encoding:'utf8',timeout:15000});const receipt={exe,args,exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr};writeFileSync(join(output,name+'.json'),JSON.stringify(receipt,null,2));assert.ifError(r.error);assert.equal(r.signal,null);return receipt;};
const direct=run(owner,[winfsp,output],'direct');assert.equal(direct.exit,0);assert.match(direct.stdout,/MOUNT_OWNER_TEST_PASS cases=6 native_mounts=0 original_failure_retained=true/);
const mount=join(output,'wrong-root'),control=join(output,'control');
const failed=run(host,[winfsp,mount,control,bridge,'--root-mismatch'],'root-mismatch');
assert.equal(failed.exit,1);assert.match(failed.stderr,/NATIVE_MOUNT_FAILED step=root-identity status=c000000d win32=0 phase=4 filesystem_owned=1 library_owned=1 probe_owned=0/);
assert.doesNotMatch(failed.stdout,/NATIVE_.*READY|NATIVE_MOUNT_ROOT_SERVED|NORMAL_CLOSE_DONE/);assert.equal(existsSync(join(control,'ready')),false);
// Original resources remain in the child until its own failing exit. Preserve the
// output and any remaining mount path: no driver stop, root deletion or recovery.
const result={status:'PASS',read_at:new Date().toISOString(),identity:{owner:hash(owner),host:hash(host),winfsp:hash(winfsp),bridge:hash(bridge)},direct_cases:6,post_effect_root_mismatch_refused:true,no_false_ready:true,workspace_qualified:false};
writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log('PASS product WinFspMount: six direct lifecycle cases and original post-mount root mismatch retained without false Ready');
