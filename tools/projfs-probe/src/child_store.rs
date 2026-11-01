//! Ordinary native I/O proof, with no SDK in the child read path.
use layerfs_projfs_probe::store_fixture::{pattern, LARGE};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::Path,
};

pub fn run(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(root.as_os_str()) {
        return Err("store-child must be launched by the live provider".into());
    }
    std::env::set_current_dir(root)?;
    let names = fs::read_dir(".")?
        .map(|e| e.map(|e| e.file_name()))
        .collect::<std::io::Result<BTreeSet<_>>>()?;
    let expected = [
        "alpha.txt",
        "empty.txt",
        "many",
        "nested",
        "never.bin",
        "中文.txt",
    ]
    .into_iter()
    .map(std::ffi::OsString::from)
    .collect();
    if names != expected {
        return Err(format!("root listing differs: {names:?}").into());
    }
    if fs::read("alpha.txt")? != b"old immutable Store version\n" {
        return Err("projection drifted to the new mutable Branch head".into());
    }
    if !fs::read("empty.txt")?.is_empty() || fs::read("中文.txt")? != "来自真实 Store\n".as_bytes()
    {
        return Err("empty or Unicode entry mismatch".into());
    }
    let many = fs::read_dir("many")?
        .map(|e| e.map(|e| e.file_name()))
        .collect::<std::io::Result<BTreeSet<_>>>()?;
    let expected = (0..80)
        .map(|n| std::ffi::OsString::from(format!("e{n:03}.txt")))
        .collect();
    if many != expected {
        return Err("paged directory lost or duplicated entries".into());
    }
    let mut file = File::open("nested/data.bin")?;
    if file.metadata()?.len() != LARGE as u64 {
        return Err("binary metadata length mismatch".into());
    }
    // The child asks only for windows. ProjFS may hydrate more via OS read-ahead;
    // report actual provider bytes, never claim only these small windows were loaded.
    for (offset, length) in [
        (0, 257),
        (4093, 23),
        (2 * 1024 * 1024 + 37, 4097),
        (LARGE - 31, 31),
    ] {
        file.seek(SeekFrom::Start(offset as u64))?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes)?;
        let expected: Vec<_> = (offset..offset + length).map(pattern).collect();
        if bytes != expected {
            return Err(format!("binary range differs at {offset}").into());
        }
    }
    drop(file);
    if File::open("missing.txt").is_ok() {
        return Err("missing path unexpectedly opened".into());
    }
    if OpenOptions::new().write(true).open("alpha.txt").is_ok() {
        return Err("projected existing file allowed a writer".into());
    }
    if fs::rename("alpha.txt", "changed.txt").is_ok() || fs::remove_file("alpha.txt").is_ok() {
        return Err("projected entry allowed rename/delete".into());
    }
    if fs::read("alpha.txt")? != b"old immutable Store version\n" {
        return Err("refused mutation changed projected bytes".into());
    }
    // A read-only Store source is not a read-only NTFS sandbox: a new local file
    // is allowed by this diagnostic and must NOT appear in the Store. Retain it.
    fs::write("local-only.txt", b"local NTFS file, not a Store Commit\n")?;
    if fs::read("local-only.txt")? != b"local NTFS file, not a Store Commit\n" {
        return Err("local-only content mismatch".into());
    }
    println!("STORE_CHILD_PASS root=6 nested=true directory_entries=80 binary_ranges=4 pinned_old_bytes=true unicode=true empty=true projected_mutations_refused=true local_create_not_writeback=true");
    Ok(())
}
