// External stand-in process for native Session grammar/custody tests; no product hooks.
import {readFileSync,writeFileSync,existsSync} from "node:fs";
const mode=process.env.NATIVE_RUNTIME_PEER_CASE;
let input=Buffer.alloc(0),bound=false,calls=0;
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
 if(!bound){if(input.length<10)return;const width=91+input.readUInt16LE(8);if(input.length<width)return;const frame=input.subarray(0,width);if(frame.subarray(0,8).toString()!=="LFSBND01")process.exit(2);input=input.subarray(width);bound=true;
  if(mode==="late-ready") {setTimeout(()=>{writeFileSync(log+".alive","true");send(root);process.stdin.pause();process.exit(0);},250);return;}
  if(mode==="bad-ready"){send(root+root);process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),30);return;}
  if(mode==="no-ready"){process.stdin.pause();clearTimeout(deadline);setTimeout(()=>process.exit(0),30);return;}
  if(mode==="fragmented") {send(root.slice(0,19));setTimeout(()=>send(root.slice(19)),10);}
  else send(root);
 }
 let at;
 while((at=input.indexOf(10))>=0){const line=input.subarray(0,at).toString();input=input.subarray(at+1);const [id,word]=line.split(" ");calls++;writeFileSync(log,JSON.stringify({calls,line}),{flag:"w"});
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
