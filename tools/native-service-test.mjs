// Standalone product route: diagnostic checker is used only for fixture/history verification.
// node tools/native-service-test.mjs <product-parent> <product-host> <WinFsp> <checker> <fresh-output>
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync,readFileSync,openSync,readSync,closeSync,renameSync,readdirSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,7);
const [parent,host,winfsp,checker,out]=process.argv.slice(2).map(p=>resolve(p));
assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const identity={parent:hash(parent),host:hash(host),winfsp:hash(winfsp),checker:hash(checker)};
const catalog=Buffer.from('explicit-native-binding-test-v1'),cursor=Buffer.alloc(32,91);
const branch=Buffer.concat([Buffer.from([0x11]),Buffer.alloc(16,41)]);
function frame(){const n=Buffer.alloc(2);n.writeUInt16LE(catalog.length);return Buffer.concat([Buffer.from('LFSBND01'),n,catalog,cursor,branch,randomBytes(32)]);}
function cli(name,args,input,env=process.env){const r=spawnSync(checker,args,{input,env,encoding:'utf8',timeout:20000});const record={exe:checker,args,exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr};writeFileSync(join(out,name+'.json'),JSON.stringify(record,null,2));assert.ifError(r.error);assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);return record;}
const fixture=join(out,'fixture');cli('setup',['binding-setup',fixture],frame(),{...process.env,LAYERFS_PROJFS_PROBE_CHILD_ROOT:fixture});
const store=join(fixture,'store.sqlite');
const processes=[];let failure=null;
function start(label){const work=join(out,label+'-work'),mount=join(out,label+'-mount');const args=[host,winfsp,store,work,mount];const record={label,exe:parent,args,started:new Date().toISOString(),stdout:'',stderr:'',exit:null,error:null};const child=spawn(parent,args,{stdio:['pipe','pipe','pipe']});child.stdin.on('error',e=>{record.error=e.message;});child.stdout.on('data',d=>record.stdout+=d);child.stderr.on('data',d=>record.stderr+=d);const ended=new Promise(done=>{child.once('error',e=>{record.error=e.message;done(record);});child.once('exit',(code,signal)=>{record.exit={code,signal};record.finished=new Date().toISOString();done(record);});});const p={child,record,ended,work,mount};processes.push(p);child.stdin.write(frame());return p;}
async function line(p,pattern){const end=Date.now()+12000;for(;;){const found=p.record.stdout.split(/\r?\n/).find(s=>pattern.test(s));if(found)return found;assert.equal(p.record.exit,null,p.record.stdout+'\n'+p.record.stderr);assert.equal(p.record.error,null);assert.ok(Date.now()<end,'deadline '+pattern+'\n'+p.record.stdout+'\n'+p.record.stderr);await new Promise(r=>setTimeout(r,5));}}
function command(p,id,text){p.child.stdin.write(id+' '+text+'\n');}
const timer=setTimeout(()=>{failure='service proof deadline 85 seconds';for(const p of processes)if(p.child.exitCode===null&&!p.child.killed)p.child.kill();},85000);
let held;
try{
 const a=start('first');await line(a,/^NATIVE_SERVICE_ROOT_SERVED .*native=true$/);
 assert.equal(readFileSync(join(a.mount,'alpha.txt'),'utf8'),'old immutable Store version\n');
 mkdirSync(join(a.mount,'native'));writeFileSync(join(a.mount,'native','item.txt'),'published by standalone product\n');
 renameSync(join(a.mount,'native','item.txt'),join(a.mount,'native','renamed.txt'));
 const large=Buffer.from(Uint8Array.from({length:300023},(_,i)=>(i*29+17)%251));writeFileSync(join(a.mount,'native','window.bin'),large);
 assert.deepEqual(readFileSync(join(a.mount,'native','window.bin')),large);
 assert.ok(readdirSync(join(a.mount,'native')).includes('renamed.txt'));
 command(a,1,'status');const status=await line(a,/^NATIVE_SERVICE_STATUS id=1 /);assert.match(status,/retained=false prepared=false/);
 command(a,2,'commit published');await line(a,/^NATIVE_SERVICE_COMMIT id=2 changed=true .*published=true$/);
 held=openSync(join(a.mount,'native','renamed.txt'),'r');command(a,3,'unmount');await line(a,/^NATIVE_SERVICE_REFUSED id=3 status=80000011 service_kept=true$/);
 const bytes=Buffer.alloc(9);assert.equal(readSync(held,bytes,0,9,0),9);assert.equal(bytes.toString(),'published');closeSync(held);held=undefined;
 // One ordinary reopen after release lets native Cleanup end any old cache
 // reference; this does not force release or retry a failed unmount.
 assert.equal(readFileSync(join(a.mount,'native','renamed.txt'),'utf8'),'published by standalone product\n');
 let sequence=4;const releaseDeadline=Date.now()+8000;
 for(;;){const id=sequence++;command(a,id,'status');const row=await line(a,new RegExp('^NATIVE_SERVICE_STATUS id='+id+' '));if(/handles=0 .*active=0 /.test(row))break;assert.ok(Date.now()<releaseDeadline,'original native Close not observed: '+row);await new Promise(r=>setTimeout(r,30));}
 const terminal=sequence++;command(a,terminal,'unmount');await line(a,new RegExp('^NATIVE_SERVICE_UNMOUNTED id='+terminal+' native_exit=0 .*overlay_closed=true$'));await a.ended;assert.deepEqual(a.record.exit,{code:0,signal:null});assert.equal(existsSync(a.mount),false);
 const overlay=readdirSync(a.work).filter(n=>n.endsWith('.sqlite')&&n!=='native-template.sqlite');assert.equal(overlay.length,0,'normal terminal process deletes its Overlay');
 const b=start('second');await line(b,/^NATIVE_SERVICE_ROOT_SERVED /);assert.equal(readFileSync(join(b.mount,'native','renamed.txt'),'utf8'),'published by standalone product\n');assert.ok(statSync(join(b.mount,'native')).isDirectory());assert.deepEqual(readFileSync(join(b.mount,'native','window.bin')),large);
 command(b,1,'commit published');await line(b,/^NATIVE_SERVICE_COMMIT id=1 changed=false /);command(b,2,'unmount');await line(b,/^NATIVE_SERVICE_UNMOUNTED id=2 /);await b.ended;assert.deepEqual(b.record.exit,{code:0,signal:null});
 const verify=cli('history',['service-verify',store],frame());assert.match(verify.stdout,/SERVICE_REOPEN_PASS commits=1 parent=None via=Workspace exact_head=true exact_bytes=true readonly=true/);
 for(const p of processes){assert.equal(p.record.error,null);assert.ok(!p.record.stdout.includes(catalog.toString()));assert.ok(!p.record.stderr.includes(catalog.toString()));assert.doesNotMatch(p.record.stdout,/OVERLAY_|STORE_CREATED/);assert.doesNotMatch(p.record.args.join(' '),/native_probe|projfs/i);}
 for(const [k,p]of Object.entries({parent,host,winfsp,checker}))assert.equal(hash(p),identity[k]);
 console.log('PASS standalone native product: no diagnostic DLL; ordinary I/O, status, published Commit, reversible Busy, terminal receipts and fresh remount exact');
}catch(e){failure=String(e);if(held!==undefined)try{closeSync(held);}catch{}for(const p of processes)if(p.child.exitCode===null&&!p.child.killed)p.child.kill();await Promise.all(processes.map(p=>p.ended));throw e;}
finally{clearTimeout(timer);writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',identity,failure,providers:processes.map(p=>p.record),diagnostic_dll_used:false,product_sdk_workspace_supported:false},null,2));}
