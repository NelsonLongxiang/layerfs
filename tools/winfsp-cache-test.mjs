// Observe native cache/mapping publication; node tools/winfsp-cache-test.mjs <host> <WinFsp-dll> <Rust-dll> <client-exe> <fresh-output>.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
function analyze(provider,application){
 assert.match(application,/CACHE_CLIENT_PASS stages=8 .*flush_api_called=false/);
 assert.match(provider,/errors=0/);assert.match(provider,/OVERLAY_STATE .*handles=0/);
 const phases=[...provider.matchAll(/CACHE_PHASE phase=(\d+) application=(\d+) published_before=(\d+) published_after=(\d+) committed=(\d+) commit_changed=(\d+) writes=(\d+) constrained=(\d+) cleanup=(\d+) close=(\d+)/g)].map(m=>Object.fromEntries(['phase','application','published_before','published_after','committed','commit_changed','writes','constrained','cleanup','close'].map((k,i)=>[k,Number(m[i+1])])));
 const clientPhases=[...application.matchAll(/CACHE_CLIENT phase=(\d+) visible=(\d+) explicit_flush=false/g)].map(m=>[Number(m[1]),Number(m[2])]);
 const scoped=[...provider.matchAll(/COMMIT_SCOPE_REFUSED phase=(\d+) requested=application-visible status=c00000bb output_unchanged=true invalid_scope=c000000d/g)].map(m=>Number(m[1]));
 assert.deepEqual(scoped,[0,1,2,3,4,5,6,7],'every live phase must refuse unproved/invalid guarantees before a published Commit');
 const commitLines=provider.split(/\r?\n/).filter(l=>l.startsWith('OVERLAY_COMMIT kind='));
 assert.ok(commitLines.length>0);for(const line of commitLines)assert.match(line,/scope=published /);
 const expected=[65,66,66,67,67,68,68,68];
 assert.deepEqual(phases.map(p=>p.phase),[0,1,2,3,4,5,6,7]);
 assert.deepEqual(clientPhases,expected.map((v,i)=>[i,v]));
 assert.deepEqual(phases.map(p=>p.application),expected);
 assert.deepEqual([...provider.matchAll(/CACHE_CAPTURE phase=(\d+) captured=65 stable=true/g)].map(m=>Number(m[1])),[0,1,2]);
 let previous=65;
 for(const p of phases){
  assert.ok(p.published_before>=previous&&p.published_before<=p.application,'published-before must represent an already written byte');
  assert.ok(p.published_after>=p.published_before&&p.published_after<=p.application,'published-after cannot precede before or invent a future value');
  assert.ok(p.close<=p.cleanup,'Close cannot precede Cleanup count');
  assert.ok(p.constrained<=p.writes);assert.ok([0,1].includes(p.commit_changed));
  if(p.phase>=2)assert.ok(p.committed>=p.published_before&&p.committed<=p.published_after,'Commit must match some published frontier inside observed window');
  else assert.equal(p.committed,0);
  previous=p.published_after;
 }
 assert.equal(phases[0].published_before,65);assert.equal(phases[7].published_after,68);assert.equal(phases[7].committed,68);
 const cleaned=new Set(),closed=new Set();let afterCleanup=0;
 for(const line of provider.split(/\r?\n/)){
  let m=/CACHE_CLEANUP handle=(\d+)/.exec(line);if(m)cleaned.add(m[1]);
  m=/CACHE_CLOSE handle=(\d+)/.exec(line);if(m){assert.ok(cleaned.has(m[1]),'exact handle Close without Cleanup');closed.add(m[1]);}
  m=/CACHE_WRITE constrained=(\d+).*handle=(\d+)/.exec(line);
  if(m){assert.ok(!closed.has(m[2]),'write after exact handle Close');if(m[1]==='1'&&cleaned.has(m[2]))afterCleanup++;}
 }
 return {phases,mappingGap:phases.some(p=>p.phase>=3&&p.phase<=6&&p.application>p.published_after),committedGap:phases.some(p=>p.phase>=3&&p.phase<=6&&p.application>p.committed),delayedConstrainedWritesAfterCleanup:afterCleanup};
}
if(process.argv[2]==='--self-test'){
 const raw=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));const p=raw.provider.stdout,a=raw.application.stdout;
 analyze(p,a);console.log('PASS analyze actual cache receipt');
 const tests=[
  ['missing scope refusal',p.replace(/^COMMIT_SCOPE_REFUSED phase=3 .*\r?\n/m,''),a],
  ['downgraded guarantee accepted',p.replace('requested=application-visible status=c00000bb','requested=application-visible status=00000000'),a],
  ['implicit published result',p.replace('OVERLAY_COMMIT kind=Committed scope=published ','OVERLAY_COMMIT kind=Committed '),a],
  ['missing phase',p.replace(/^CACHE_PHASE phase=4 .*\r?\n/m,''),a],
  ['future byte',p.replace('phase=3 application=67 published_before=','phase=3 application=67 published_before=99'),a],
  ['lost final Commit',p.replace(/(CACHE_PHASE phase=7 .*committed=)\d+/,(_m,prefix)=>prefix+'65'),a],
  ['invented application phase',p,a.replace('phase=5 visible=68','phase=5 visible=67')],
  ['unproved capture',p.replace('CACHE_CAPTURE phase=1 captured=65 stable=true','CACHE_CAPTURE phase=1 captured=66 stable=true'),a],
  ['close without cleanup',p+'\nCACHE_CLOSE handle=999 cleanup=1\n',a],
  ['stale handle write',p+'\nCACHE_CLEANUP handle=999 flags=0 closes=0\nCACHE_CLOSE handle=999 cleanup=1\nCACHE_WRITE constrained=1 append=0 offset=0 requested=1 done=1 handle=999\n',a],
 ];
 for(const [name,pv,av]of tests){assert.throws(()=>analyze(pv,av),name);console.log('PASS reject '+name);}
 process.exit(0);
}
assert.equal(process.platform,'win32');assert.equal(process.argv.length,7);
const [host,dll,bridge,client,out]=process.argv.slice(2).map(v=>resolve(v));
assert.ok(!existsSync(out),'never overwrite proof');mkdirSync(out);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const identity={host:sha(host),winfsp:sha(dll),bridge:sha(bridge),client:sha(client)};
const refused=spawnSync(client,['cache-child',out],{encoding:'utf8',timeout:5000});
writeFileSync(join(out,'direct-refusal.json'),JSON.stringify({exit:refused.status,stdout:refused.stdout,stderr:refused.stderr},null,2));
assert.ifError(refused.error);assert.equal(refused.status,1);assert.match(refused.stderr,/requires its diagnostic parent/);
function launch(exe,args,env=process.env){
 const item={exe,args,started:new Date().toISOString(),stdout:'',stderr:'',exit:null,error:null};
 const child=spawn(exe,args,{env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>{item.stdout+=d;});child.stderr.on('data',d=>{item.stderr+=d;});
 const ended=new Promise(resolve=>{child.once('error',e=>{item.error=e.message;resolve(item);});child.once('exit',(code,signal)=>{item.exit={code,signal};item.finished=new Date().toISOString();resolve(item);});});
 return {item,child,ended};
}
const mount=join(out,'mount'),control=join(out,'control');
const provider=launch(host,[dll,mount,control,bridge,'--cache-boundary']);let application=null,failure=null;
const timer=setTimeout(()=>{failure='native cache experiment exceeded 50 seconds';if(application)application.child.kill();provider.child.kill();},50000);
try{
 const until=Date.now()+12000;
 while(!existsSync(join(control,'ready'))){assert.equal(provider.item.exit,null,provider.item.stdout+provider.item.stderr);assert.equal(provider.item.error,null);assert.ok(Date.now()<until,'provider ready deadline');await new Promise(r=>setTimeout(r,10));}
 application=launch(client,['cache-child',out],{...process.env,LAYERFS_PROJFS_PROBE_CHILD_ROOT:out});
 const app=await application.ended;assert.equal(app.exit?.code,0,app.stdout+app.stderr);assert.equal(app.exit?.signal,null);
 writeFileSync(join(control,'stop'),'stop',{flag:'wx'});
 const prov=await provider.ended;assert.equal(prov.exit?.code,0,prov.stdout+prov.stderr);assert.equal(prov.exit?.signal,null);
 const analysis=analyze(prov.stdout,app.stdout);const phases=analysis.phases;
 const reopened=spawnSync(client,['verify-cache',join(control,'store/store.sqlite')],{encoding:'utf8',timeout:15000});
 writeFileSync(join(out,'reopen.json'),JSON.stringify({exit:reopened.status,stdout:reopened.stdout,stderr:reopened.stderr},null,2));
 assert.ifError(reopened.error);assert.equal(reopened.status,0,reopened.stdout+reopened.stderr);assert.match(reopened.stdout,/REOPEN_CACHE_PASS/);
 const savedBytes=[...reopened.stdout.matchAll(/CACHE_HISTORY .* byte=(\d+) parent=/g)].map(m=>Number(m[1]));
 assert.deepEqual(savedBytes,phases.filter(p=>p.commit_changed===1).map(p=>p.committed),'reopened versions must match changed Commit checkpoints');
 assert.equal(sha(host),identity.host);assert.equal(sha(bridge),identity.bridge);assert.equal(sha(client),identity.client);assert.equal(sha(dll),identity.winfsp);assert.equal(existsSync(mount),false);
 writeFileSync(join(out,'observations.json'),JSON.stringify({identity,...analysis,scope:'observation, no timing-independent publication guarantee; no explicit flush',workspace_qualified:false},null,2));
 console.log(JSON.stringify({status:'PASS',...analysis,conclusion:'native mapping observations captured; not complete mapping qualification'},null,2));
}catch(e){failure=String(e);for(const p of [application,provider]){if(p&&p.child.exitCode===null&&!p.child.killed)p.child.kill();}await Promise.all([application?.ended,provider.ended]);throw e;}
finally{clearTimeout(timer);writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',identity,failure,provider:provider.item,application:application?.item??null,workspace_qualified:false},null,2));}
