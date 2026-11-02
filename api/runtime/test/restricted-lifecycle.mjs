// Original restrictedProcess lifecycle consumer with an external wire peer.
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {restrictedProcess} from '../src/platform/native-windows/restricted.js';
const [selected,dir]=process.argv.slice(2);const out=resolve(dir);assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const errors=[],before=[];let root,starts=0;
const adapter=restrictedProcess({executable:process.execPath,sid:fileURLToPath(new URL('./fixture/restricted-peer.mjs',import.meta.url))},{executable:selected,args:[],env:process.env},out,e=>errors.push(e),e=>before.push(e));
adapter.observe(()=>starts++,(value)=>root=value);
adapter.child.stdout.resume();adapter.child.stderr.resume();adapter.child.stdin.end();
let failed=null;
try{
 const closed=await new Promise((ok,no)=>{adapter.child.once('error',no);adapter.child.once('close',(code,signal)=>ok({code,signal}));});
 const complete=adapter.close(closed.code,closed.signal);
 if(selected==='legal'){assert.equal(complete,true);assert.equal(starts,1);assert.deepEqual(root,{exitCode:7,signal:null});assert.equal(errors.length,0);assert.equal(before.length,0);}
 else if(selected==='before-effect'){assert.equal(complete,false);assert.equal(starts,0);assert.equal(before.length,1);assert.equal(errors.length,0);}
 else{assert.equal(complete,false);assert.equal(errors.length,1);assert.equal(before.length,0);assert.ok(errors[0].cause);}
 console.log('PASS restricted receipt '+selected);
}catch(e){failed=e.message;throw e;}
finally{writeFileSync(join(out,'result.json'),JSON.stringify({status:failed?'FAIL':'PASS',selected,failure:failed,starts,root,retained_errors:errors.length,before_effect_failures:before.length,actual_token:false},null,2));}
