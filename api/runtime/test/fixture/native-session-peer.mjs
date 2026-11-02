// External stand-in process for native Session grammar/custody tests; no product hooks.
import {readFileSync,writeFileSync,existsSync} from "node:fs";
const mode=process.env.NATIVE_RUNTIME_PEER_CASE;
let input=Buffer.alloc(0),bound=false,calls=0,workspace="",branch="";
const head="12"+"ab".repeat(32),base="32"+"cd".repeat(32),rootId="ef".repeat(32);
const state=id=>"NATIVE_SERVICE_STATE id="+id+" workspace="+workspace+" branch="+branch+" head=- base="+base+" root="+rootId+" revision=7 dirty_inodes=1 dirty_entries=2 handles=0 active=0 retained=false prepared=false pending_commit=0 pending_merge=false\n";
const publication=id=>"NATIVE_SERVICE_PUBLICATION id="+id+" changed=true revision=8 head="+head+" base="+base+" root="+rootId+" parent=- displaced=- merge_from=- merge_head=- published=true\n";
const log=process.env.NATIVE_RUNTIME_PEER_LOG;
const root="NATIVE_SERVICE_ROOT_SERVED root=1 sdk_ready=false native=true\n";
const status=(id,n="7")=>"NATIVE_SERVICE_STATUS id="+id+" root=1 revision="+n+" handles=0 requests=9 active=0 retained=false prepared=false pending_commit=0 files=0 directories=0\n";
const send=(line)=>process.stdout.write(line);
const deadline=setTimeout(()=>process.exit(0),5000);
function normal(id,kind){
 if(kind==="status")send(status(id));
 else if(kind==="commit")send("NATIVE_SERVICE_COMMIT id="+id+" changed=true revision=8 published=true\n");
 else {send("NATIVE_SERVICE_UNMOUNTED id="+id+" native_exit=0 dispatcher_exit=c0000120 overlay_closed=true\n");clearTimeout(deadline);process.stdin.pause();setTimeout(()=>process.exit(0),20);}
}
process.stdin.on("data",chunk=>{
 input=Buffer.concat([input,chunk]);
 if(!bound){if(input.length<14)return;const registered=input.subarray(0,8).toString()==="LFSREG01";const width=registered?46+input.readUInt16LE(8)+input.readUInt16LE(10)+input.readUInt16LE(12):91+input.readUInt16LE(8);if(input.length<width)return;const frame=input.subarray(0,width);if(!registered&&frame.subarray(0,8).toString()!=="LFSBND01")process.exit(2);const n=input.readUInt16LE(8);workspace=(registered?frame.subarray(14,46):frame.subarray(59+n)).toString("hex");branch=registered?"11"+"01".repeat(16):frame.subarray(42+n,59+n).toString("hex");input=input.subarray(width);bound=true;
  if(mode==="sdk-loss-bootstrap"){process.stdout.end();process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);return;}
  if(mode==="late-ready") {setTimeout(()=>{writeFileSync(log+".alive","true");send(root);process.stdin.pause();process.exit(0);},250);return;}
  if(mode==="bad-ready"){send(root+root);process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),30);return;}
  if(mode==="no-ready"){process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),30);return;}
  if(mode==="fragmented") {send(root.slice(0,19));setTimeout(()=>send(root.slice(19)),10);}
  else send(root);
 }
 let at;
 while((at=input.indexOf(10))>=0){const line=input.subarray(0,at).toString();input=input.subarray(at+1);const [id,word]=line.split(" ");calls++;writeFileSync(log,JSON.stringify({calls,line}),{flag:"w"});
  if(mode.startsWith("sdk-")||mode.startsWith("identity-")||mode.startsWith("dirty-")){
   if((mode==="sdk-loss-state"&&word==="state"&&calls>1)||(mode==="sdk-loss-publication"&&word==="commit")){process.stdout.end();process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);continue;}
   if(mode==="dirty-clean"&&word==="unmount"&&calls===1)send("NATIVE_SERVICE_REFUSED id="+id+" status=e0f50001 service_kept=true\n");
   else if(mode==="dirty-discard"&&word==="unmount") {send("NATIVE_SERVICE_REFUSED id="+id+" status=e0f50001 service_kept=true\n");process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
   else if(word==="state") {
    let answer=state(id);
    if(mode==="identity-workspace"||mode==="sdk-lost-mount")answer=answer.replace(workspace,"ff".repeat(32));
    if(mode==="identity-branch")answer=answer.replace(branch,"11"+"ff".repeat(16));
    if(mode==="identity-overflow")answer=answer.replace("revision=7","revision=18446744073709551616");
    send(answer);
   }else if(word==="commit"){
    let answer=publication(id);
    if(mode==="identity-null-head")answer=answer.replace("head="+head,"head=-");
    if(mode==="identity-foreign-publication")answer=answer.replace("id="+id,"id="+String(BigInt(id)+1n));
    if(mode==="identity-short-root")answer=answer.replace(rootId,"ff");
    send(answer);
   }else normal(id,word);
   if(!['identity-valid','dirty-clean','sdk-scope','sdk-loss-state','sdk-loss-publication'].includes(mode)){process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
   continue;
  }
  if(mode==="foreign-id"){send(status(String(BigInt(id)+1n)));process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
  else if(mode==="duplicate-reply"){send(status(id)+status(id));process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
  else if(mode==="overflow"){send(status(id,"18446744073709551616"));process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
  else if(mode==="root-mismatch"){send(status(id).replace("root=1","root=2"));process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
  else if(mode==="line-window"){send("x".repeat(4097)+"\n");process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
  else if(mode==="unknown"){send("NATIVE_SERVICE_REFUSED id="+id+" status=c0000001\n");process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
  else if(mode==="reply-eof-live"){process.stdout.end();setTimeout(()=>{writeFileSync(log+".alive","true");clearTimeout(deadline);process.stdin.pause();process.exit(0);},250);}
  else if(mode==="failed-terminal"){send("NATIVE_SERVICE_UNMOUNTED id="+id+" native_exit=0 dispatcher_exit=c0000120 overlay_closed=true\n");process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(1),20);}
  else if(mode==="partial-terminal"){send("NATIVE_SERVICE_UNMOUNTED id="+id+" native_exit=0 dispatcher_exit=c0000120 overlay_closed=true\npartial");process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),20);}
  else if(mode==="terminal-without-exit"){
    send("NATIVE_SERVICE_UNMOUNTED id="+id+" native_exit=0 dispatcher_exit=c0000120 overlay_closed=true\n");writeFileSync(log+".terminal","sent");
    const poll=setInterval(()=>{if(existsSync(log+".release")){clearInterval(poll);clearTimeout(deadline);process.stdin.pause();process.exit(0);}},5);
  }
  else if(mode==="busy"&&word==="unmount"&&calls===1)send("NATIVE_SERVICE_REFUSED id="+id+" status=80000011 service_kept=true\n");
  else normal(id,word);
 }
});
