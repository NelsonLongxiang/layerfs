// External malformed restricted-launcher stand-in; never claims token isolation.
import fs from 'node:fs';
const selected=process.argv[3]==="--instance-command"?process.argv[6]:process.argv[3];
const send=s=>fs.writeSync(3,s);
const start='LFS_EXEC_STARTED pid=12345 restricted=true integrity=low\n';
if(selected.startsWith('handoff-')){send('LFS_EXEC_PREPARED request=1 response=2\n');if(['handoff-refused','handoff-mismatch'].includes(selected)){send('LFS_EXEC_FAILED phase=instance win32=193 started=false\n');process.exit(1);}send(start+'LFS_EXEC_EXIT code=7\n');process.exit(0);}
if(selected==='legal'){send(start);send('LFS_EXEC_EXIT code=7\n');process.exit(0);}
if(selected==='before-effect'){send('LFS_EXEC_FAILED phase=create win32=193 started=false\n');process.exit(1);}
if(selected==='partial'){send(start+'LFS_EXEC_EX');process.exit(1);}
if(selected==='duplicate'){send(start+start);process.exit(0);}
if(selected==='overflow'){send(start+'LFS_EXEC_EXIT code=4294967296\n');process.exit(0);}
if(selected==='false-exit'){send(start+'LFS_EXEC_EXIT code=0\n');process.exit(1);}
if(selected==='bad-cancel'){send(start+'LFS_EXEC_CANCEL requested=true\n');process.exit(0);}
if(selected==='unknown'){send(start+'LFS_EXEC_FAILED phase=wait win32=6 started=true\n');process.exit(1);}
if(selected==='oversize'){send('X'.repeat(4097));process.exit(0);}
process.exit(2);
