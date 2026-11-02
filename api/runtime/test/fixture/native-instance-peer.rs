// External native-instance wire peer; no token/desktop implementation or product hook.
use std::io::{self, BufRead, Write};
fn main() {
 let mode=std::env::var("LAYERFS_INSTANCE_PEER_CASE").unwrap();
 if mode=="sdk-guard" {std::thread::spawn(||{std::thread::sleep(std::time::Duration::from_secs(10));std::process::exit(0);});}
 let ready=format!("LFS_INSTANCE_READY pid={} created=1 restricted=true integrity=low\n",std::process::id());
 if mode=="setup" {print!("LFS_INSTANCE_FAILED win32=5\n");io::stdout().flush().unwrap();std::process::exit(1);}
 if mode=="late" {std::thread::sleep(std::time::Duration::from_millis(200));print!("{ready}");io::stdout().flush().unwrap();return;}
 if mode=="wrong-pid" {print!("{}",ready.replace(&format!("pid={}",std::process::id()),"pid=1"));io::stdout().flush().unwrap();return;}
 print!("{ready}");io::stdout().flush().unwrap();
 if mode=="duplicate-ready" {print!("{ready}");io::stdout().flush().unwrap();return;}
 for input in io::stdin().lock().lines() {
  let input=input.unwrap();let words:Vec<_>=input.split_whitespace().collect();let id=words[0].parse::<u64>().unwrap();let action=words[1];
  if mode=="eof" {return;}
  if mode=="oversize" {println!("{}","x".repeat(4097));io::stdout().flush().unwrap();return;}
  if mode=="partial" {print!("LFS_INSTANCE_STA");io::stdout().flush().unwrap();return;}
  if mode=="foreign" {println!("LFS_INSTANCE_STATUS id={} restricted=true integrity=low",id+1);io::stdout().flush().unwrap();return;}
  if mode=="wrong-kind" {println!("LFS_INSTANCE_CLOSED id={id} token_closed=true desktop_closed=true");io::stdout().flush().unwrap();return;}
  if action=="status" {
   println!("LFS_INSTANCE_STATUS id={id} restricted=true integrity=low");io::stdout().flush().unwrap();
   if mode=="duplicate" {println!("LFS_INSTANCE_STATUS id={id} restricted=true integrity=low");io::stdout().flush().unwrap();return;}
  } else if action=="close" {
   println!("LFS_INSTANCE_CLOSED id={id} token_closed=true desktop_closed=true");io::stdout().flush().unwrap();
   if mode=="terminal-live" {let file=std::env::var("LAYERFS_INSTANCE_PEER_RELEASE").unwrap();let until=std::time::Instant::now()+std::time::Duration::from_secs(3);while !std::path::Path::new(&file).exists() {if std::time::Instant::now()>until {std::process::exit(90)};std::thread::sleep(std::time::Duration::from_millis(5));}}
   if mode=="failed-close" {std::process::exit(1)}
   return;
  }
 }
}
