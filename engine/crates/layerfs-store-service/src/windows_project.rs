//! Shared owner-private Windows SDK project record reader. It returns authority
//! only to in-process product consumers, never a credential-export endpoint.
use layerfs_bridge::{
    control::{Answer, ControlError, Reply, SdkValue},
    provision::{StoreManifest, StoreProfile},
};
use std::{
    fmt,
    fs::File,
    io::{self, Read},
    path::Path,
};

#[derive(Debug)]
pub enum ReadError {
    Io(io::Error),
    Unauthorized,
    Invalid(&'static str),
    Codec(ControlError),
}
impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "project record I/O: {e}"),
            Self::Unauthorized => f.write_str("project record requires private owner-only entries"),
            Self::Invalid(s) => write!(f, "project record: {s}"),
            Self::Codec(e) => write!(f, "project record codec: {e}"),
        }
    }
}
impl std::error::Error for ReadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            Self::Codec(e) => Some(e),
            _ => None,
        }
    }
}
pub struct RegisteredProject {
    pub manifest: StoreManifest,
    pub installed: Option<StoreManifest>,
}
fn private(path: &Path, directory: bool) -> Result<(), ReadError> {
    let meta = std::fs::symlink_metadata(path).map_err(ReadError::Io)?;
    if meta.file_type().is_symlink()
        || (if directory {
            !meta.is_dir()
        } else {
            !meta.is_file()
        })
    {
        return Err(ReadError::Unauthorized);
    }
    crate::windows_acl::require_owner_only(path).map_err(|_| ReadError::Unauthorized)
}
/// One bounded record read, using the same protected format that SDK Init writes.
/// Parent identity/path substitution by an equally privileged process is not fenced.
pub fn read(home: &Path, project: &str) -> Result<RegisteredProject, ReadError> {
    if !home.is_absolute()
        || project.is_empty()
        || project == "."
        || project == ".."
        || project.contains(['/', '\\', ':', '\0'])
    {
        return Err(ReadError::Invalid(
            "absolute home and single project component required",
        ));
    }
    layerfs_history::HistoryName::new(project).map_err(|_| ReadError::Invalid("project name"))?;
    private(home, true)?;
    let directory = home.join(project);
    private(&directory, true)?;
    let path = directory.join("project.record");
    private(&path, false)?;
    let file = File::open(path).map_err(ReadError::Io)?;
    if file.metadata().map_err(ReadError::Io)?.len() > 65535 {
        return Err(ReadError::Invalid("record processing window"));
    }
    let mut bytes = Vec::new();
    file.take(65536)
        .read_to_end(&mut bytes)
        .map_err(ReadError::Io)?;
    let answer = Answer::decode(&bytes).map_err(ReadError::Codec);
    bytes.fill(0);
    let answer = answer?;
    if answer.id != 1 {
        return Err(ReadError::Invalid("record identity"));
    }
    let Reply::Sdk(value) = answer.reply else {
        return Err(ReadError::Invalid("record kind"));
    };
    let decode = |key| match value.get(key) {
        Some(SdkValue::Bytes(b)) => StoreManifest::decode(b).map_err(ReadError::Codec),
        _ => Err(ReadError::Invalid("complete manifest required")),
    };
    let manifest = decode("manifest")?;
    if manifest.profile != StoreProfile::Disposable || manifest.daemon_sqlite.is_some() {
        return Err(ReadError::Invalid(
            "explicit sealed Disposable manifest required",
        ));
    }
    let installed = if matches!(value.get("installed"), Some(SdkValue::Bytes(_))) {
        Some(decode("installed")?)
    } else {
        None
    };
    if let Some(installed) = &installed {
        let mut expected = manifest.clone();
        expected.daemon_sqlite = installed.daemon_sqlite.clone();
        if installed.daemon_sqlite.is_none() || installed != &expected {
            return Err(ReadError::Invalid(
                "installed authority differs from sealed project",
            ));
        }
    }
    Ok(RegisteredProject {
        manifest,
        installed,
    })
}
