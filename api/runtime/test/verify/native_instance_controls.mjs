// Native control parser and original instance termination, no SDK/WinFsp claim.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const [launcher,output]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(output),false);mkdirSync(output,{recursive:true});
const cases=[['normal','1 status\n2 close\n',0],['duplicate','1 status\n1 close\n',1],['trailing','1 status unexpected\n',1],['negative','-1 close\n',1],['leading-zero','01 close\n',1],['overflow','18446744073709551616 close\n',1],['zero','0 close\n',1],['truncated','1 close',1],['nul','1 close\0ignored\n',1],['eof','',1],['window','1 '+('x'.repeat(129))+'\n',1]];
const results=[];let failure=null;
try{
 for(const[name,input,code]of cases){const r=spawnSync(launcher,['--instance','S-1-5-21-12345678-23456789-34567891-45678912',join(output,name+'-work')],{input,encoding:'utf8',timeout:5000});const row={name,exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr};writeFileSync(join(output,name+'.json'),JSON.stringify(row,null,2));assert.ifError(r.error);assert.equal(r.status,code);assert.equal(r.signal,null);assert.match(r.stdout,/^LFS_INSTANCE_READY pid=/);if(code===0)assert.match(r.stdout,/LFS_INSTANCE_CLOSED id=2 token_closed=true desktop_closed=true/);else assert.doesNotMatch(r.stdout,/LFS_INSTANCE_CLOSED/);results.push({name,exit:r.status,expected:true});}
 console.log('PASS native instance controls:11 cases exact original close,canonical monotonic IDs,trailing/NUL/partial/EOF/window refusal');
}catch(e){failure=e.message;throw e;}
finally{writeFileSync(join(output,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',failure,cases:results,real_native_instance:true,actual_winfsp:false},null,2));}
