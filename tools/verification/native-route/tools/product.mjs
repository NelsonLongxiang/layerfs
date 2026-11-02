// Import retained product/permission/instance results. No mount, command launch,
// credential access or source-Store mutation. Archived audits use embedded bytes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {audit as auditBaseline,hash} from './lifecycle.mjs';
export {hash};
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
export const protocol=['validation','legal','setup','foreign','wrong-kind','eof','partial','oversize','duplicate','duplicate-ready','wrong-pid','late','failed-close','terminal-live'];
export const receipts=['legal','before-effect','partial','duplicate','overflow','false-exit','bad-cancel','unknown','oversize','handoff-legal','handoff-refused','handoff-mismatch','handoff-lost'];
export const controls=['normal','duplicate','trailing','negative','leading-zero','overflow','zero','truncated','nul','eof','window'];
export const commandCases=['stream','late-consumer','backpressure','validation','spawn-failure','environment','cancel','process-before-streams','output-abandoned'];
export const boundaryCases=['missing-project','missing-branch','protected-main','zero-workspace','truncated','invalid-home-utf8','project-escape','corrupt-record'];
const r='tmp/registered-native-20261102/',e='tmp/native-exec-20261102/',s='tmp/restricted-native-20261102/',i='tmp/native-instance-20261102/';
export const inputs={
 registered:r+'actual-final/result.json',registered_command:r+'actual-final-command.json',registered_init:r+'actual-final/init.json',registered_seal:r+'loc-comparison.json',
 explicit:r+'explicit-final/result.json',explicit_command:r+'explicit-final-command.json',history:r+'explicit-final/history.json',record_tests:r+'record-tests-command.json',
 boundaries:r+'boundaries-final/result.json',boundaries_command:r+'boundaries-final-command.json',
 execution:e+'actual-final/result.json',execution_command:e+'actual-final-command.json',execution_seal:e+'loc-comparison.json',
 restricted:s+'actual-final/result.json',restricted_command:s+'actual-final-command.json',restricted_seal:s+'loc-comparison.json',restricted_build:s+'final-native-build.json',
 instance:i+'actual-final/result.json',instance_command:i+'actual-final-command.json',instance_init:i+'actual-final/init.json',instance_seal:i+'loc-comparison.json',
 instance_controls:i+'controls-sealed/result.json',instance_controls_command:i+'controls-sealed-command.json',instance_build:i+'sealed-native-build.json',instance_build_readback:i+'sealed-native-build-readback.json',
 instance_failed:i+'actual-first/result.json',instance_failed_command:i+'actual-first-command.json',borrow:i+'borrow-observation/result.json',
 direct:i+'direct-restricted-final/result.json',direct_command:i+'direct-restricted-final-command.json',guard:i+'guard-final.json',
 ...Object.fromEntries(boundaryCases.map(n=>['boundary_'+n,r+'boundaries-final/'+n+'.json'])),
 ...Object.fromEntries(protocol.flatMap(n=>[['protocol_'+n,i+'protocol-final-'+n+'/result.json'],['protocol_command_'+n,i+'protocol-final-'+n+'-command.json']])),
 ...Object.fromEntries(receipts.flatMap(n=>[['receipt_'+n,i+'receipt-final-'+n+'/result.json'],['receipt_command_'+n,i+'receipt-final-'+n+'-command.json']])),
 ...Object.fromEntries(controls.map(n=>['control_'+n,i+'controls-sealed/'+n+'.json'])),
 ...Object.fromEntries(commandCases.map(n=>['execution_command_'+n,e+'unit-final-'+n+'.json'])),
 ...Object.fromEntries(receipts.slice(0,9).flatMap(n=>[['restricted_receipt_'+n,s+'receipt-argv-fixed-'+n+'/result.json'],['restricted_receipt_command_'+n,s+'receipt-argv-fixed-'+n+'-command.json']]))
};
export const sources={
 registered:{commit:'8fe5dbf90ab0c3b36556013083de5d757459d6f7',tested:'6b323f099bfae5b327a1cc20f1b2b20c3e56194b',paths:['api/runtime/src','engine/crates/layerfs-daemon/src/native','engine/crates/layerfs-node/src/discovery_windows.rs','engine/crates/layerfs-store-service/src/windows_project.rs'],harness:'api/runtime/test/verify/registered_native_real.mjs'},
 execution:{commit:'eeb53b091c2a667f27a7eae93ed924b1c12c65fd',tested:'58c3c51fcaf3e8215a771540442bca513d0a743a',paths:['api/runtime/src'],harness:'api/runtime/test/verify/native_exec_real.mjs'},
 restricted:{commit:'17d73fa42f69af0f41643be6f5e1cbb4609f7bc2',tested:'3650431162eec45e208258db62df30915052f554',paths:['api/runtime/src','engine/crates/layerfs-sandbox/src/windows','engine/crates/layerfs-fuse/src/windows','engine/crates/layerfs-daemon/src/native/process.rs'],harness:'api/runtime/test/verify/restricted_native_real.mjs'},
 instance:{commit:'687b8b3585257db13d146468720de484ad076da9',tested:'0978d12b250e770bb7a7dc5719c54ae22949b0df',paths:['api/runtime/src','engine/crates/layerfs-sandbox/src/windows'],harness:'api/runtime/test/verify/native_instance_real.mjs'}
};
const tableNames={product:'product_runtime_evidence',restricted:'restricted_access_evidence',instance:'resident_instance_evidence'};
export const artifactNames=[...Object.keys(inputs),...commandCases.map(n=>'execution_case_'+n),...Object.keys(sources).map(n=>'harness_'+n),'manifest'].sort();
export function command(v,code=0){assert.equal(v.kind,'foreground');assert.equal(v.exitCode,code);assert.equal(v.signal,null);assert.equal(v.timedOut,false);assert.equal(v.aborted,false);assert.equal(v.stdout.truncated,false);assert.equal(v.stderr.truncated,false);assert.ok(v.timeoutMs<=120000);return v.stdout.text;}
function pass(v){assert.equal(v.status,'PASS');assert.equal(v.failure,null);}
function observed(v){assert.ok(Number.isFinite(Date.parse(v.read_at)));for(const h of Object.values(v.identity))assert.match(h,/^[0-9a-f]{64}$/);}
function events(v){const e=Object.fromEntries(v.events.map(e=>[e.label,e]));assert.equal(Object.keys(e).length,v.events.length);return e;}
function terminal(v){assert.equal(v.nativeExit,0);assert.equal(v.processExit,0);assert.equal(v.processSignal,null);assert.equal(v.overlayClosed,true);assert.ok(['c0000120','00000000'].includes(v.dispatcherExit));}
function owned(v){pass(v);assert.equal(v.runtime_closed,true);assert.deepEqual(v.owned,[]);observed(v);}
function exactManifest(a){
 assert.equal(a.manifest.kind,'retained-native-product-evidence');assert.ok(Number.isFinite(Date.parse(a.manifest.imported_at)));
 assert.match(a.manifest.baseline_sha256,/^[0-9a-f]{64}$/);assert.equal(a.manifest.provenance,'retained-mixed-source-assertions-not-build-attestation');
 assert.equal(a.manifest.old_binaries,'recorded-identities-not-current-byte-rechecks');assert.equal(a.manifest.full_sdk_qualification,0);
 assert.deepEqual(Object.keys(a.manifest.sources),Object.keys(sources));
 for(const [key,want]of Object.entries(sources)){
  const got=a.manifest.sources[key];assert.equal(got.commit,want.commit);assert.equal(got.tested,want.tested);assert.match(got.tree,/^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(got.blobs),want.paths);for(const id of Object.values(got.blobs))assert.match(id,/^[0-9a-f]{40}$/);
  assert.equal(got.harness,want.harness);assert.equal(hash(a['harness_'+key]),got.harness_sha256);
 }
 assert.deepEqual(Object.keys(a.manifest.current_binary_sha256),Object.keys(a.instance.identity));assert.deepEqual(a.manifest.current_binary_sha256,a.instance.identity);
}
export function facts(a){
 assert.deepEqual(Object.keys(a).sort(),artifactNames);exactManifest(a);
 const m=a.manifest;const common={id:1,imported_at:m.imported_at,artifact_count:artifactNames.length,identity_checked:1,raw_audit_required:1,sdk_qualification:0,full_host_isolation:0};
 for(const key of Object.keys(sources)){
  const result=key==='registered'?a.registered:key==='execution'?a.execution:key==='restricted'?a.restricted:a.instance;
  observed(result);const seal=a[key==='execution'?'execution_seal':key==='registered'?'registered_seal':key==='restricted'?'restricted_seal':'instance_seal'];
  assert.equal(seal.tested_tree,m.sources[key].tested);assert.ok(Date.parse(result.read_at)<Date.parse(m.imported_at));command(a[key+'_command']);
 }
 owned(a.registered);assert.equal(a.registered.authority_exported,false);assert.equal(a.registered.sdk_init_and_store_consumer,true);assert.equal(a.registered.sandbox_workspace_supported,false);
 assert.equal(a.registered_init.step,'done');assert.equal(a.registered_init.error,null);assert.equal(a.registered_init.project.name,'registered-project');
 const rg=events(a.registered);assert.equal(rg['sdk-fork'].result.kind,'Forked');assert.equal(rg['sdk-fork'].result.head,null);assert.match(rg.registered.id,/^[0-9a-f]{64}$/);
 assert.equal(rg.commit.changed,true);assert.equal(rg.commit.scope,'published');assert.equal(rg.commit.published,true);
 const history=rg['sdk-commits'].result;assert.equal(history.items.length,1);assert.equal(history.hasMore,false);const c=history.items[0];
 assert.equal(c.branch,'feature');assert.equal(c.parent,null);assert.equal(c.secondParent,null);assert.equal(c.via,'exec');assert.equal(c.base,rg['sdk-fork'].result.base);assert.equal(c.logical,300088);terminal(rg.terminal);
 command(a.explicit_command);owned(a.explicit);assert.equal(a.explicit.public_runtime_api,true);assert.equal(a.explicit.product_sdk_workspace_supported,false);assert.equal(a.explicit.identity.executable,a.registered.identity.executable);
 assert.equal(a.history.exit,0);assert.equal(a.history.signal,null);assert.equal(a.history.error,null);assert.match(a.history.stdout,/SERVICE_REOPEN_PASS commits=1 parent=None via=Workspace exact_head=true exact_bytes=true readonly=true binary_bytes=300023/);
 assert.match(command(a.record_tests),/6 passed; 0 failed/);pass(a.boundaries);command(a.boundaries_command);assert.equal(a.boundaries.no_credential_input,true);assert.equal(a.boundaries.cases.length,8);
 for(const name of boundaryCases){const v=a['boundary_'+name];assert.equal(v.name,name);assert.equal(v.exit,1);assert.equal(v.error,null);assert.equal(v.signal,null);assert.doesNotMatch(v.stdout,/ROOT_SERVED|UNMOUNTED/);assert.equal(v.mount_exists,false);assert.equal(v.work_exists,['missing-branch','protected-main'].includes(name));}
 owned(a.execution);assert.equal(a.execution.actual_winfsp,true);assert.equal(a.execution.sandbox_isolation,false);assert.equal(a.execution.sdk_workspace_supported,false);
 const ex=events(a.execution),cmd=ex.command;assert.equal(cmd.receipt.exitCode,9);assert.equal(cmd.receipt.signal,null);assert.equal(cmd.receipt.stdoutEnded,true);assert.equal(cmd.receipt.stderrEnded,true);assert.equal(cmd.receipt.cancellationRequested,false);
 assert.equal(cmd.output.length,2);for(const stream of cmd.output)assert.deepEqual(stream,{bytes:2097183,sha256:'6cf6c312318da2d187864a06539e020f6940dd96aad46d60f5b9405171173157'});
 assert.ok(ex['no-implicit-commit']);assert.deepEqual(ex['root-exit-not-filesystem-drain'],{label:'root-exit-not-filesystem-drain',rootExit:4,nativeBusy:true});terminal(ex['first-terminal']);assert.equal(ex['explicit-root-cancellation'].signal,'SIGTERM');assert.equal(ex['explicit-root-cancellation'].exitCode,null);assert.equal(ex['explicit-root-cancellation'].cancellationRequested,true);
 for(const name of commandCases){command(a['execution_command_'+name]);const v=a['execution_case_'+name];pass(v);assert.equal(v.selected,name);assert.equal(v.actual_winfsp,false);assert.equal(v.sandbox_isolation,false);if(name==='output-abandoned'){assert.equal(v.owned.length,1);assert.equal(v.owned[0].executionRetained,true);}else assert.deepEqual(v.owned,[]);}
 assert.ok(a.harness_registered.includes('assert.equal(commits.items.length,1)'));assert.ok(a.harness_execution.includes('assert.deepEqual(readFileSync(join(second.path,\'binary.bin\'))'));
 owned(a.restricted);assert.equal(a.restricted.restricted_boundary,true);assert.equal(a.restricted.sdk_sandbox_supported,false);const sec=events(a.restricted),access=sec['native-access-check'];assert.equal(access.stderr,'');
 assert.match(access.stdout,/TOKEN restricted=1 integrity=4096 bcrypt=00000000 rtl=1 rtl_error=0/);assert.match(access.stdout,/LAUNCHER allowed=0 error=5/);assert.match(access.stdout,/LAUNCHER_TOKEN allowed=0 error=5/);
 const count=pattern=>(access.stdout.match(pattern)||[]).length;assert.equal(count(/READ index=[0-9]+ allowed=0 error=5/g),4);assert.equal(count(/ALTER index=[0-9]+ allowed=0 error=5/g),4);assert.equal(count(/PROCESS allowed=0 error=5/g),2);assert.equal(count(/PROCESS_TOKEN allowed=0 error=5/g),2);
 const denied=JSON.parse(sec['restricted-root'].stdout);assert.equal(denied.env,null);assert.equal(denied.denied.length,4);assert.ok(denied.denied.every(v=>v.denied&&['EPERM','EACCES'].includes(v.code)));assert.ok(denied.denied.some(v=>v.path.endsWith('project.record')));assert.ok(denied.denied.some(v=>v.path.endsWith('native-template.sqlite')));
 assert.equal(sec['restricted-root'].root.exitCode,7);assert.equal(sec['restricted-root'].root.signal,null);assert.equal(sec['restricted-root'].terminal.restricted,true);assert.equal(sec['argv-exact'].arguments,5);terminal(sec['native-terminal']);assert.equal(sec.cancelled.cexit.exitCode,1223);assert.equal(sec.cancelled.cexit.signal,null);assert.equal(sec.cancelled.done.restricted,true);assert.equal(sec.cancelled.done.cancellationRequested,true);
 for(const name of receipts.slice(0,9)){command(a['restricted_receipt_command_'+name]);const v=a['restricted_receipt_'+name];pass(v);assert.equal(v.selected,name);assert.equal(v.actual_token,false);}
 assert.ok(a.harness_restricted.includes('assert.deepEqual(readFileSync(join(second.path,\'restricted.bin\')),binary)'));
 pass(a.instance);assert.deepEqual(a.instance.instances,[]);assert.deepEqual(a.instance.sessions,[]);assert.equal(a.instance.runtime_closed,true);assert.equal(a.instance.sdk_container_sandbox,false);assert.equal(a.instance.native_resident_context,true);assert.equal(a.instance_init.step,'done');assert.equal(a.instance_init.error,null);
 const ins=events(a.instance),ready=ins['created-running'],idle=ins['instance-idle'];assert.equal(ready.state,'running');assert.equal(ready.mode,'windows-restricted');assert.ok(Number.isSafeInteger(ready.pid)&&ready.pid>0);assert.equal(ready.sessions,0);assert.equal(ready.restricted,true);assert.equal(ready.integrity,'low');assert.equal(idle.id,ready.id);assert.equal(idle.pid,ready.pid);assert.equal(idle.sessions,0);assert.equal(idle.state,'running');
 assert.equal(ins['same-private-desktop'].equal,true);assert.equal(ins['borrowed-original-context'].restricted,true);assert.equal(ins['borrowed-original-context'].exitCode,7);assert.equal(ins['cancel-original-process-handle'].exit,1223);terminal(ins['first-terminal']);
 const close=ins['instance-closed'];assert.equal(close.tokenClosed,true);assert.equal(close.desktopClosed,true);assert.equal(close.processExit,0);assert.equal(close.processSignal,null);
 assert.ok(a.harness_instance.includes('assert.equal((await instance.status()).sessions,2)'));assert.ok(a.harness_instance.includes("await assert.rejects(instance.close(),{code:'MountsActive'})"));assert.ok(a.harness_instance.includes("await assert.rejects(instance.mount('feature'),{code:'NoSuchSandbox'})"));
 const released=new Set(['validation','legal','setup','terminal-live']);for(const name of protocol){command(a['protocol_command_'+name]);const v=a['protocol_'+name];pass(v);assert.equal(v.selected,name);assert.equal(v.actual_token,false);if(released.has(name))assert.deepEqual(v.instances,[]);else{assert.equal(v.instances.length,1);assert.equal(v.instances[0].state,'retained');}}
 for(const name of receipts){command(a['receipt_command_'+name]);const v=a['receipt_'+name];pass(v);assert.equal(v.selected,name);assert.equal(v.actual_token,false);if(['legal','handoff-legal'].includes(name)){assert.equal(v.starts,1);assert.deepEqual(v.root,{exitCode:7,signal:null});assert.equal(v.retained_errors,0);}else if(['before-effect','handoff-refused'].includes(name)){assert.equal(v.starts,0);assert.equal(v.before_effect_failures,1);assert.equal(v.retained_errors,0);}else{assert.equal(v.retained_errors,1);assert.equal(v.before_effect_failures,0);}}
 pass(a.instance_controls);command(a.instance_controls_command);assert.equal(a.instance_controls.real_native_instance,true);assert.equal(a.instance_controls.actual_winfsp,false);assert.equal(a.instance_controls.cases.length,11);for(const name of controls){const v=a['control_'+name];assert.equal(v.name,name);assert.equal(v.exit,name==='normal'?0:1);assert.equal(v.error,null);assert.equal(v.signal,null);assert.match(v.stdout,/^LFS_INSTANCE_READY/);if(name==='normal')assert.match(v.stdout,/LFS_INSTANCE_CLOSED id=2 token_closed=true desktop_closed=true/);else assert.doesNotMatch(v.stdout,/LFS_INSTANCE_CLOSED/);}
 assert.equal(a.instance_failed.status,'FAIL');assert.equal(a.instance_failed.failure.code,'Failed');command(a.instance_failed_command,1);assert.match(a.borrow.borrow.output[3],/phase=create win32=1314 started=false/);assert.equal(a.borrow.result.code,0);assert.equal(a.borrow.result.signal,null);
 assert.equal(a.instance_build.job.status,'completed');assert.equal(a.instance_build.job.detail,'exit code: 0');assert.equal(a.instance_build_readback.sha256,a.instance.identity.restrictedLauncher);assert.equal(a.instance_build_readback.inputs.length,5);for(const v of a.instance_build_readback.inputs)assert.match(v.sha256,/^[0-9a-f]{64}$/);
 command(a.direct_command);owned(a.direct);assert.equal(a.direct.identity.restrictedLauncher,a.instance.identity.restrictedLauncher);assert.equal(a.direct.sdk_sandbox_supported,false);assert.equal(a.direct.restricted_boundary,true);assert.match(command(a.guard),/scanned 1010 production/);
 return {
 product:{...common,source_commit:m.sources.registered.commit,tested_tree:m.sources.registered.tested,execution_source:m.sources.execution.commit,observed_at:a.registered.read_at,execution_at:a.execution.read_at,registered_init:1,authority_exported:0,sdk_commits:1,commit_base_matches:1,history_exact_binary:300023,output_bytes:2097183,root_exit:9,no_implicit_commit:1,root_exit_not_drain:1,normal_terminal:1,startup_refusals:8,record_tests:6,command_cases:9,assertion_based_remount:1,nonpromotion:1},
 restricted:{...common,source_commit:m.sources.restricted.commit,tested_tree:m.sources.restricted.tested,observed_at:a.restricted.read_at,restricted_token:1,integrity:4096,rng_available:1,backend_read_denials:4,backend_acl_denials:4,parent_memory_denials:3,parent_token_denials:3,argv_cases:5,root_exit:7,cancel_exit:1223,environment_filtered:1,receipt_cases:9,mount_write_assertion:1,commit_readback_assertion:1,normal_terminal:1,nonpromotion:1},
 instance:{...common,source_commit:m.sources.instance.commit,tested_tree:m.sources.instance.tested,observed_at:a.instance.read_at,original_pid:ready.pid,resident_running:1,initial_sessions:0,same_private_desktop:1,simultaneous_mount_assertion:2,active_close_refusal_assertion:1,no_autostart_assertion:1,binary_remount_assertion:300023,root_exit:7,cancel_exit:1223,idle_sessions:0,token_closed:1,desktop_closed:1,resident_exit:0,protocol_cases:14,receipt_cases:13,native_control_cases:11,old_privilege_failure:1314,old_failure_retained:1,token_handle_exported:0,nonpromotion:1}
 };
}
export function audit(db){
 auditBaseline(db);const raw=db.prepare('SELECT * FROM product_artifacts ORDER BY name').all();assert.deepEqual(raw.map(v=>v.name),artifactNames);
 for(const v of raw)assert.equal(hash(v.body),v.sha256,'artifact digest '+v.name);
 const a=Object.fromEntries(raw.map(v=>[v.name,v.format==='text'?v.body:JSON.parse(v.body)]));const rows=facts(a);
 for(const [key,table]of Object.entries(tableNames)){const data=db.prepare('SELECT * FROM '+table).all();assert.equal(data.length,1);assert.deepEqual({...data[0]},rows[key]);}
 for(const [table,digest]of Object.entries(a.manifest.baseline_tables))assert.equal(hash(JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY 1').all())),digest,'baseline drift '+table);
 return rows;
}
function main(){
 if(process.argv[2]==='--audit'){const db=new DatabaseSync(resolve(process.argv[3]),{readOnly:true});try{console.log(JSON.stringify({status:'PASS',facts:audit(db)}));}finally{db.close();}return;}
 assert.equal(process.argv.length,4,'closed-baseline fresh-output');const base=resolve(process.argv[2]),out=resolve(process.argv[3]);assert.equal(existsSync(out),false);assert.equal(existsSync(base+'-wal'),false);
 const raw=Object.fromEntries(Object.entries(inputs).map(([k,p])=>[k,{body:readFileSync(join(repo,p),'utf8'),format:'json',source:p}]));
 for(const n of commandCases){const r=JSON.parse(raw['execution_command_'+n].body),path=r.stdout.text.match(/evidence=(.*)/)?.[1]?.trim();assert.ok(path);raw['execution_case_'+n]={body:readFileSync(join(path,'result.json'),'utf8'),format:'json',source:join(path,'result.json')};}
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,timeout:10000});assert.ifError(r.error);assert.equal(r.status,0,String(r.stderr));return r.stdout;};
 const attributed=Object.fromEntries(Object.entries(sources).map(([key,s])=>{
  const blobs=Object.fromEntries(s.paths.map(p=>{const id=git('rev-parse',s.commit+':'+p).toString().trim();assert.equal(id,git('rev-parse',s.tested+':'+p).toString().trim());return[p,id];}));
  const body=git('show',s.commit+':'+s.harness).toString('utf8');assert.equal(body,git('show',s.tested+':'+s.harness).toString('utf8'));raw['harness_'+key]={body,format:'text',source:'git:'+s.commit+':'+s.harness};return[key,{...s,tree:git('rev-parse',s.commit+'^{tree}').toString().trim(),blobs,harness_sha256:hash(body)}];
 }));
 const db0=new DatabaseSync(base,{readOnly:true});let tables;try{auditBaseline(db0);tables=Object.fromEntries(db0.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,hash(JSON.stringify(db0.prepare('SELECT * FROM '+name+' ORDER BY 1').all()))]));}finally{db0.close();}
 const identity=JSON.parse(raw.instance.body).identity;
 const current={addon:'tmp/registered-native-20261102/final.node',executable:'tmp/native-git-product-target/debug/layerfs-native.exe',host:'tmp/restricted-native-20261102/final-mount/layerfs-winfsp.exe',winfsp:'C:/Program Files (x86)/WinFsp/bin/winfsp-x64.dll',restrictedLauncher:'tmp/native-instance-20261102/product-sealed/layerfs-restricted.exe',accessProbe:'tmp/native-instance-20261102/probe-observed/restricted-probe.exe'};
 const binary=Object.fromEntries(Object.entries(current).map(([k,p])=>[k,hash(readFileSync(resolve(repo,p)))]));assert.deepEqual(binary,identity);
 const manifest={kind:'retained-native-product-evidence',imported_at:new Date().toISOString(),baseline_sha256:hash(readFileSync(base)),baseline_tables:tables,sources:attributed,current_binary_sha256:binary,old_binaries:'recorded-identities-not-current-byte-rechecks',provenance:'retained-mixed-source-assertions-not-build-attestation',full_sdk_qualification:0};
 raw.manifest={body:JSON.stringify(manifest,null,2),format:'json',source:'import-manifest'};const values=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,v.format==='text'?v.body:JSON.parse(v.body)]));const rows=facts(values);
 mkdirSync(out,{recursive:true});copyFileSync(base,join(out,'snapshot.sqlite'));const db=new DatabaseSync(join(out,'snapshot.sqlite'));
 try{
  db.exec('CREATE TABLE product_artifacts(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,format TEXT NOT NULL,source TEXT NOT NULL,body TEXT NOT NULL)');
  for(const [key,table]of Object.entries(tableNames)){const row=rows[key];db.exec('CREATE TABLE '+table+'('+Object.entries(row).map(([k,v])=>k+(k==='id'?' INTEGER PRIMARY KEY':typeof v==='number'?' INTEGER':' TEXT')).join(',')+')');db.prepare('INSERT INTO '+table+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));}
  const put=db.prepare('INSERT INTO product_artifacts VALUES(?,?,?,?,?)');for(const[k,v]of Object.entries(raw))put.run(k,hash(v.body),v.format,v.source,v.body);audit(db);
 }finally{db.close();}
 assert.equal(hash(readFileSync(base)),manifest.baseline_sha256);writeFileSync(join(out,'import.json'),JSON.stringify({...manifest,artifact_count:artifactNames.length,facts:rows,snapshot_sha256:hash(readFileSync(join(out,'snapshot.sqlite')))},null,2));console.log(JSON.stringify({status:'IMPORTED',artifact_count:artifactNames.length,facts:rows}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
