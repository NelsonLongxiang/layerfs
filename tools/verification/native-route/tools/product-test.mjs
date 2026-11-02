// Corrupt independent in-memory copies; never modify retained source material.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {audit,facts,hash} from './product.mjs';
const path=process.argv[2];assert.ok(path);const digest=hash(readFileSync(path));
const db=new DatabaseSync(path,{readOnly:true});const raw=Object.fromEntries(db.prepare('SELECT name,body,format FROM product_artifacts').all().map(r=>[r.name,r.format==='text'?r.body:JSON.parse(r.body)]));
audit(db);console.log('PASS real raw audit with old FAILs preserved');
const corruptions=[
 ['missing original',a=>delete a.instance],['missing harness',a=>delete a.harness_instance],['wrong source',a=>a.manifest.sources.instance.commit='f'.repeat(40)],['promote provenance',a=>a.manifest.provenance='signed-build-attestation'],['promote SDK',a=>a.manifest.full_sdk_qualification=1],
 ['registered authority export',a=>a.registered.authority_exported=true],['wrong Commit parent',a=>a.registered.events.find(e=>e.label==='sdk-commits').result.items[0].parent='invented'],['missing Init',a=>a.registered_init.step='failed'],['invented exact binary',a=>a.history.stdout=a.history.stdout.replace('300023','300022')],['native parent failed',a=>a.registered.events.find(e=>e.label==='terminal').processExit=1],['startup accepted',a=>a['boundary_missing-branch'].exit=0],
 ['wrong root exit',a=>a.execution.events.find(e=>e.label==='command').receipt.exitCode=0],['output cut',a=>a.execution.events.find(e=>e.label==='command').output[0].bytes--],['no implicit claim missing',a=>a.execution.events=a.execution.events.filter(e=>e.label!=='no-implicit-commit')],['root exit equated to drain',a=>a.execution.events.find(e=>e.label==='root-exit-not-filesystem-drain').nativeBusy=false],['abandoned output released',a=>a['execution_case_output-abandoned'].owned=[]],
 ['backend readable',a=>a.restricted.events.find(e=>e.label==='native-access-check').stdout=a.restricted.events.find(e=>e.label==='native-access-check').stdout.replace('READ index=1 allowed=0','READ index=1 allowed=1')],['ACL change accepted',a=>a.restricted.events.find(e=>e.label==='native-access-check').stdout=a.restricted.events.find(e=>e.label==='native-access-check').stdout.replace('ALTER index=1 allowed=0','ALTER index=1 allowed=1')],['parent token allowed',a=>a.restricted.events.find(e=>e.label==='native-access-check').stdout=a.restricted.events.find(e=>e.label==='native-access-check').stdout.replace('LAUNCHER_TOKEN allowed=0','LAUNCHER_TOKEN allowed=1')],['integrity not low',a=>a.restricted.events.find(e=>e.label==='native-access-check').stdout=a.restricted.events.find(e=>e.label==='native-access-check').stdout.replace('integrity=4096','integrity=8192')],['environment leaked',a=>a.restricted.events.find(e=>e.label==='restricted-root').stdout=JSON.stringify({...JSON.parse(a.restricted.events.find(e=>e.label==='restricted-root').stdout),env:'secret'})],
 ['resident replacement',a=>a.instance.events.find(e=>e.label==='instance-idle').pid++],['desktop not shared',a=>a.instance.events.find(e=>e.label==='same-private-desktop').equal=false],['token not closed',a=>a.instance.events.find(e=>e.label==='instance-closed').tokenClosed=false],['resident still held',a=>a.instance.instances=[{state:'running'}]],['unknown released',a=>a.protocol_foreign.instances=[]],['handoff contradiction released',a=>a['receipt_handoff-mismatch'].retained_errors=0],['control EOF closed',a=>a.control_eof.stdout+='LFS_INSTANCE_CLOSED id=1 token_closed=true desktop_closed=true\n'],['old failure erased',a=>a.instance_failed.status='PASS'],['privilege failure recast',a=>a.borrow.borrow.output[3]=a.borrow.borrow.output[3].replace('1314','0')]
];
for(const[name,mutate]of corruptions){const next=structuredClone(raw);mutate(next);assert.throws(()=>facts(next),name);console.log('PASS reject '+name);}
const memory=new DatabaseSync(':memory:');
try{
 for(const t of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
  memory.exec(t.sql);for(const row of db.prepare('SELECT * FROM '+t.name).all())memory.prepare('INSERT INTO '+t.name+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
 }
 for(const[name,sql]of [
  ['body digest','UPDATE product_artifacts SET body=body||\' \' WHERE name=\'instance\''],['raw digest','UPDATE product_artifacts SET sha256=\'f\' WHERE name=\'restricted\''],['missing artifact','DELETE FROM product_artifacts WHERE name=\'history\''],['parsed product promotion','UPDATE product_runtime_evidence SET sdk_qualification=1'],['parsed permission weakened','UPDATE restricted_access_evidence SET parent_token_denials=2'],['parsed instance exit','UPDATE resident_instance_evidence SET resident_exit=1'],['historic Workspace rewritten','UPDATE receipts SET status=\'PASS\' WHERE id=\'workspace-live\''],['historic Git close rewritten','UPDATE git_evidence SET close_complete=1']]){
  memory.exec('BEGIN');try{memory.exec(sql);assert.throws(()=>audit(memory),name);}finally{memory.exec('ROLLBACK');}console.log('PASS reject '+name);
 }
 audit(memory);
}finally{memory.close();db.close();}
assert.equal(hash(readFileSync(path)),digest);console.log('PASS source snapshot unchanged');console.log('TOTAL product audit controls='+String(2+corruptions.length+8));
