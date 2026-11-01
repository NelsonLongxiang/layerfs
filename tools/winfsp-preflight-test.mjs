// Native driver preflight regression; node tools/winfsp-preflight-test.mjs <verified-msi> <new-output>.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
assert.equal(process.platform,'win32');assert.ok(process.argv[2]&&process.argv[3]);
const msi=resolve(process.argv[2]),out=resolve(process.argv[3]);assert.ok(!existsSync(out));mkdirSync(out);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const before=sha(msi);
const script=fileURLToPath(new URL('./winfsp-preflight.ps1',import.meta.url));
function run(name,args){
 const started=new Date().toISOString();const r=spawnSync('pwsh',['-NoProfile','-File',script,...args],{encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
 writeFileSync(join(out,name+'.json'),JSON.stringify({started,finished:new Date().toISOString(),args,exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr},null,2));
 assert.ifError(r.error);assert.equal(r.signal,null);const value=JSON.parse(r.stdout);
 assert.equal(value.liveMountVerified,false);assert.equal(value.workspaceQualified,false);
 return {exit:r.status,value};
}
const actual=run('actual',['-Installer',msi]);
assert.ok([0,2].includes(actual.exit));assert.equal(actual.value.installer.verified,true);
assert.equal(actual.value.installer.prerelease,true);
if(actual.exit===2)assert.notEqual(actual.value.status,'api-load-candidate');
console.log('PASS actual component status='+actual.value.status+' exit='+actual.exit+'; no live readiness claim');
const invalid=join(out,'invalid.msi');writeFileSync(invalid,'not an installer');
const bad=run('invalid-installer',['-Installer',invalid]);assert.equal(bad.exit,1);assert.equal(bad.value.status,'probe-error');assert.equal(bad.value.installer.verified,false);
console.log('PASS invalid installer refuses');
const missing=run('missing-installer',['-Installer',join(out,'absent.msi')]);assert.equal(missing.exit,1);assert.equal(missing.value.status,'probe-error');
console.log('PASS missing installer refuses');assert.equal(sha(msi),before);
writeFileSync(join(out,'result.json'),JSON.stringify({status:'PASS',cases:3,installer_sha256:before,observed:actual.value.status,liveMountVerified:false,workspaceQualified:false},null,2));
