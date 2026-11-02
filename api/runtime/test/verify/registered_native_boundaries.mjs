// Native registered-startup failures, using an already completed real SDK fixture.
// node ... <parent> <host> <WinFsp> <fixture-with-init.json> <fresh-output>
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes,createHash} from "node:crypto";
import {existsSync,mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {resolve,join} from "node:path";
assert.equal(process.platform,"win32");assert.equal(process.argv.length,7);
const [executable,host,winfsp,fixture,out]=process.argv.slice(2).map(p=>resolve(p));
assert.equal(existsSync(out),false);mkdirSync(out,{recursive:true});
const init=JSON.parse(readFileSync(join(fixture,"init.json"),"utf8")),project=init.project.name;
const store=join(init.project.volume,"global","store.sqlite"),home=join(fixture,"home");
const hash=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const cases=[];let failure=null;
function frame(h=home,p=project,b="feature",workspace=randomBytes(32)){
 const parts=[h,p,b].map(s=>Buffer.from(s,"utf8")),header=Buffer.alloc(14);header.write("LFSREG01");parts.forEach((s,i)=>header.writeUInt16LE(s.length,8+i*2));return Buffer.concat([header,workspace,...parts]);
}
function run(name,input,extra){
 const work=join(out,name+"-work"),path=join(out,name+"-mount");
 const r=spawnSync(executable,[host,winfsp,store,work,path],{input,encoding:"utf8",timeout:10000});
 const row={name,exit:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr,work_exists:existsSync(work),mount_exists:existsSync(path)};
 writeFileSync(join(out,name+".json"),JSON.stringify(row,null,2));assert.ifError(r.error);assert.equal(r.status,1);assert.equal(r.signal,null);assert.doesNotMatch(r.stdout,/ROOT_SERVED|UNMOUNTED/);assert.match(r.stderr,/NATIVE_SERVICE_FAILED/);assert.equal(row.mount_exists,false);
 if(extra)extra(row);cases.push({name,exit:r.status,work_exists:row.work_exists,expected_failure:true});
}
try{
 run("missing-project",frame(home,"no-project"),r=>assert.equal(r.work_exists,false));
 run("missing-branch",frame(home,project,"no-branch"),r=>{assert.equal(r.work_exists,true);assert.match(r.stderr,/MissingBranch/);});
 run("protected-main",frame(home,project,"main"),r=>{assert.equal(r.work_exists,true);assert.match(r.stderr,/ProtectedBranch/);});
 run("zero-workspace",frame(home,project,"feature",Buffer.alloc(32)),r=>assert.equal(r.work_exists,false));
 const short=frame();run("truncated",short.subarray(0,short.length-1),r=>assert.equal(r.work_exists,false));
 const encoding=frame();encoding[46]=255;run("invalid-home-utf8",encoding,r=>assert.equal(r.work_exists,false));
 const escape=frame(home,"../"+project);run("project-escape",escape,r=>assert.equal(r.work_exists,false));
 const badHome=join(out,"bad-home");mkdirSync(join(badHome,"broken"),{recursive:true});writeFileSync(join(badHome,"broken","project.record"),"not a project record");
 const acl=spawnSync("pwsh",["-NoProfile","-Command","$ErrorActionPreference='Stop'; $who=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name; & icacls.exe $env:LAYERFS_TEST_HOME /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $who) /T; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"],{env:{...process.env,LAYERFS_TEST_HOME:badHome},encoding:"utf8",timeout:10000});writeFileSync(join(out,"bad-record-acl.json"),JSON.stringify({exit:acl.status,stdout:acl.stdout,stderr:acl.stderr},null,2));assert.equal(acl.status,0);
 run("corrupt-record",frame(badHome,"broken"),r=>assert.equal(r.work_exists,false));
 console.log("PASS registered native startup boundaries: 8 exact rejections without false RootServed/unmount; missing Branch and protected main retain initialized Store owner");
}catch(error){failure={message:error.message};throw error;}
finally{writeFileSync(join(out,"result.json"),JSON.stringify({status:failure?"FAIL":"PASS",read_at:new Date().toISOString(),cases,failure,identity:{executable:hash(executable),host:hash(host),winfsp:hash(winfsp)},sdk_project_fixture:fixture,no_credential_input:true},null,2));}
