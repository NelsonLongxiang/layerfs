#![forbid(unsafe_code)]
#[cfg(windows)]
mod child_store;
use layerfs_native_probe::{seed, NAME};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

fn child(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Internal child mode is not a general command that mutates caller directories.
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(root.as_os_str()) {
        return Err("child mode must be launched by the live provider".into());
    }
    std::env::set_current_dir(root)?;
    let names = fs::read_dir(".")?
        .map(|e| e.map(|x| x.file_name()))
        .collect::<std::io::Result<Vec<_>>>()?;
    if !names.iter().any(|name| name == NAME) {
        return Err("projected entry absent from enumeration".into());
    }
    let expected = seed();
    if fs::read(NAME)? != expected {
        return Err("hydrated bytes differ".into());
    }
    let mut file = fs::File::open(NAME)?;
    file.seek(SeekFrom::Start(4093))?;
    let mut part = [0; 23];
    file.read_exact(&mut part)?;
    if part != expected[4093..4116] {
        return Err("unaligned content read differs".into());
    }
    drop(file);
    let mut file = OpenOptions::new().append(true).open(NAME)?;
    file.write_all(b"native append\n")?;
    drop(file);
    let mut after = expected;
    after.extend_from_slice(b"native append\n");
    if fs::read(NAME)? != after {
        return Err("native write not visible".into());
    }
    fs::rename(NAME, "renamed.txt")?;
    if Path::new(NAME).exists() {
        return Err("renamed base entry reappeared".into());
    }
    if fs::read("renamed.txt")? != after {
        return Err("rename lost content".into());
    }
    fs::write("local.txt", b"temporary local content\n")?;
    if fs::read("local.txt")? != b"temporary local content\n" {
        return Err("local create lost content".into());
    }
    fs::remove_file("local.txt")?;
    if Path::new("local.txt").exists() {
        return Err("deleted local file reappeared".into());
    }
    println!("CHILD_PASS enumerate hydrate unaligned-read append rename create delete");
    Ok(())
}
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_some_and(|a| a == "child") && args.len() == 2 {
        if let Err(error) = child(Path::new(&args[1])) {
            eprintln!("CHILD_FAIL {error}");
            std::process::exit(1);
        }
        return;
    }
    #[cfg(windows)]
    {
        if args.len() == 2 && args[0] == "store-child" {
            if let Err(error) = child_store::run(Path::new(&args[1])) {
                eprintln!("STORE_CHILD_FAIL {error}");
                std::process::exit(1);
            }
            return;
        }
        if args.len() == 2 && (args[0] == "binding-setup" || args[0] == "binding-verify") {
            let mode = if args[0] == "binding-setup" {
                "binding-setup"
            } else {
                "binding-verify"
            };
            if let Err(error) = layerfs_native_probe::binding_probe::run(mode, Path::new(&args[1]))
            {
                eprintln!("EXPLICIT_BINDING_CHECK_FAIL {error}");
                std::process::exit(1);
            }
            return;
        }
        if args.len() == 2 && args[0] == "hold-lane" {
            if let Err(error) = layerfs_native_probe::commit_hold::hold(Path::new(&args[1])) {
                eprintln!("LANE_HOLD_FAIL {error}");
                std::process::exit(1);
            }
            return;
        }
        if args.len() == 2 && args[0] == "verify-concurrent" {
            if let Err(error) =
                layerfs_native_probe::commit_reopen::verify_concurrent(Path::new(&args[1]))
            {
                eprintln!("REOPEN_CONCURRENT_FAIL {error}");
                std::process::exit(1);
            }
            return;
        }
        if args.len() == 2 && args[0] == "verify-cache" {
            if let Err(error) =
                layerfs_native_probe::commit_reopen::verify_cache(Path::new(&args[1]))
            {
                eprintln!("REOPEN_CACHE_FAIL {error}");
                std::process::exit(1);
            }
            return;
        }
        if args.len() == 2 && args[0] == "verify-commits" {
            if let Err(error) = layerfs_native_probe::commit_reopen::verify(Path::new(&args[1])) {
                eprintln!("REOPEN_COMMIT_FAIL {error}");
                std::process::exit(1);
            }
            return;
        }
        use layerfs_native_probe::windows::{
            capture_child, capture_live, check, live, live_store, namespace_child, namespace_live,
            ProbeError,
        };
        let result = if args.len() == 2 && args[0] == "mapping-coordination" {
            layerfs_native_probe::windows::mapping_coordination(Path::new(&args[1]))
        } else if args.len() == 3 && args[0] == "mapping-lifetime" {
            layerfs_native_probe::windows::mapping_lifetime(
                Path::new(&args[1]),
                &args[2].to_string_lossy(),
            )
        } else if args.len() == 2 && args[0] == "cache-child" {
            layerfs_native_probe::windows::cache_child(Path::new(&args[1]))
        } else if args.len() == 2 && args[0] == "close-child" {
            layerfs_native_probe::windows::close_child(Path::new(&args[1]))
        } else if args.len() == 1 && args[0] == "check" {
            check()
        } else if args.len() == 2 && args[0] == "live" {
            live(Path::new(&args[1]))
        } else if args.len() == 2 && args[0] == "store-live" {
            live_store(Path::new(&args[1]))
        } else if args.len() == 2 && args[0] == "capture-live" {
            capture_live(Path::new(&args[1]))
        } else if args.len() == 2 && args[0] == "capture-child" {
            capture_child(Path::new(&args[1]))
        } else if args.len() == 2 && args[0] == "namespace-live" {
            namespace_live(Path::new(&args[1]))
        } else if args.len() == 2 && args[0] == "namespace-child" {
            namespace_child(Path::new(&args[1]))
        } else {
            eprintln!("usage: layerfs-projfs-probe check | live <new-absolute-root> | store-live <new-absolute-root> | capture-live <new-absolute-root> | namespace-live <new-absolute-root>");
            std::process::exit(1);
        };
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(if matches!(error, ProbeError::Unavailable(_)) {
                2
            } else {
                1
            });
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("Unavailable: Windows ProjFS only");
        std::process::exit(2);
    }
}
