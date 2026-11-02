// Raw inherited owner protocol against a closed real SDK fixture; no Store writes.
// <parent> <host> <WinFsp> <closed-fixture> <fresh-output>
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
assert.equal(process.platform,'win32');assert.equal(process.argv.length,7);
const [executable,host,winfsp,fixture,out]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const init=JSON.parse(readFileSync(join(fixture,'init.json'),'utf8')),home=join(fixture,'home'),store=join(init.project.volume,'global/store.sqlite');
const parts=[home,init.project.name,'feature'].map(s=>Buffer.from(s)),header=Buffer.alloc(14);header.write('LFSREG01');parts.forEach((p,i)=>header.writeUInt16LE(p.length,8+i*2));const binding=Buffer.concat([header,randomBytes(32),...parts]);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),identity={executable:hash(executable),host:hash(host),winfsp:hash(winfsp)};
const child=spawn(executable,[host,winfsp,store,join(out,'work'),join(out,'mount')],{stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true});
let pending='',stderr='',failure=null;const received=[],requests=[],queue=[];let waiter;
child.stderr.on('data',b=>stderr+=b.toString('utf8'));
const closed=new Promise((ok,no)=>{child.once('error',no);child.once('close',(code,signal)=>ok({code,signal}));});
child.stdout.on('data',b=>{pending+=b.toString('utf8');for(let end;(end=pending.indexOf('\n'))>=0;){const line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);received.push(line);if(waiter){const w=waiter;waiter=undefined;clearTimeout(w.timer);w.ok(line);}else queue.push(line);}});
function line(){if(queue.length)return Promise.resolve(queue.shift());return new Promise((ok,no)=>{assert.equal(waiter,undefined);const timer=setTimeout(()=>{waiter=undefined;no(Error('original wire reply deadline'));},5000);waiter={ok,timer};});}
let id=0;
async function command(suffix){const n=++id,request=n+' '+suffix+'\n';requests.push({id:n,request,bytes:Buffer.byteLength(request)});child.stdin.write(request);const answer=await line();assert.match(answer,new RegExp(' id='+n+' '));return answer;}
const stateKey=s=>s.replace(/^NATIVE_SERVICE_STATE id=[0-9]+ /,'');
try{
 child.stdin.write(binding);assert.match(await line(),/^NATIVE_SERVICE_ROOT_SERVED /);const before=await command('state');
 const invalid=['zz','f','c080','eda080','00','0d','c285','78'.repeat(4097),'78 trailing-token'];
 for(const encoded of invalid){const answer=await command('commit published identity message '+encoded);assert.match(answer,/status=c000000d$/);assert.equal(stateKey(await command('state')),stateKey(before));}
 for(const force of ['TRUE','1','null','true force false']){assert.match(await command('commit published identity message none force '+force),/status=c000000d$/);assert.equal(stateKey(await command('state')),stateKey(before));}
 for(const encoded of ['-','none',Buffer.from('界'.repeat(1365)+'x').toString('hex')])for(const suffix of ['',' force false',' force true'])assert.match(await command('commit published identity message '+encoded+suffix),/changed=false .*published=true$/);
 assert.equal(stateKey(await command('state')),stateKey(before));assert.match(await command('unmount clean'),/native_exit=0 .*overlay_closed=true$/);const end=await closed;assert.deepEqual(end,{code:0,signal:null});assert.equal(pending,'');console.log('PASS original message wire: 13 exact rejections, 9 clean UpToDate replies and normal terminal');
}catch(e){failure={message:e.message};throw e;}
finally{writeFileSync(join(out,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS original inherited message validation',read_at:new Date().toISOString(),identity,failure,requests,received,stderr,mountExists:existsSync(join(out,'mount')),closedFixture:fixture},null,2));}
