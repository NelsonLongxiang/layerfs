// External restricted-launcher probe. No WinFsp or Sandbox capability inferred.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const [launcher,out]=process.argv.slice(2).map(p=>resolve(p));assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const r=spawnSync(launcher,['S-1-5-21-13709321-24861271-19076333-7349','C:/Windows/System32',process.execPath,'-e',"process.stdout.write('restricted-process-ran');process.exitCode=7"],{stdio:['pipe','pipe','pipe','pipe','pipe'],encoding:'utf8',timeout:12000,env:{SystemRoot:process.env.SystemRoot??'C:/Windows',PATH:process.env.PATH}});
const record={exit:r.status,signal:r.signal,error:r.error?.message??null,output:r.output};writeFileSync(join(out,'result.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));assert.ifError(r.error);assert.equal(r.status,0);assert.equal(r.stdout,'restricted-process-ran');assert.match(r.output[3],/LFS_EXEC_STARTED pid=[0-9]+ restricted=true integrity=low\nLFS_EXEC_EXIT code=7/);
