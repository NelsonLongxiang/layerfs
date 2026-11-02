//! Native callback status conversion and portable metadata values.
use layerfs_content::ContentError;
use layerfs_workspace::{ViewStat, WorkspaceError};
pub type Result<T> = std::result::Result<T, Error>;
/// An explicit guarantee request, not an inferred state of the Windows cache.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitScope {
    Published,
    ApplicationVisible,
}
impl TryFrom<u32> for CommitScope {
    type Error = Error;
    fn try_from(value: u32) -> Result<Self> {
        match value {
            1 => Ok(Self::Published),
            2 => Ok(Self::ApplicationVisible),
            _ => Err(refused(
                0xc000000d,
                "Commit scope must be explicit: 1=published, 2=application-visible",
            )),
        }
    }
}
#[derive(Clone, Debug)]
pub struct Error {
    pub status: i32,
    pub detail: String,
    pub source: Option<std::sync::Arc<dyn std::error::Error + Send + Sync>>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.detail)
    }
}
impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_deref()
            .map(|e| e as &(dyn std::error::Error + 'static))
    }
}
pub(super) fn sourced(e: impl std::error::Error + Send + Sync + 'static) -> Error {
    Error {
        status: 0xc0000001u32 as i32,
        detail: e.to_string(),
        source: Some(std::sync::Arc::new(e)),
    }
}
pub fn failed(e: impl std::fmt::Display) -> Error {
    Error {
        status: 0xc0000001u32 as i32,
        detail: e.to_string(),
        source: None,
    }
}
pub fn refused(status: u32, detail: &str) -> Error {
    Error {
        status: status as i32,
        detail: detail.into(),
        source: None,
    }
}
pub(super) fn workspace_error(e: WorkspaceError) -> Error {
    let status: u32 = match &e {
        WorkspaceError::Content(ContentError::PathNotFound)
        | WorkspaceError::Refused(layerfs_workspace::Refusal::Missing) => 0xc0000034,
        WorkspaceError::Refused(layerfs_workspace::Refusal::Exists) => 0xc0000035,
        WorkspaceError::Refused(layerfs_workspace::Refusal::NotDirectory) => 0xc0000103,
        WorkspaceError::Refused(layerfs_workspace::Refusal::NotEmpty) => 0xc0000101,
        WorkspaceError::Refused(layerfs_workspace::Refusal::NotPermitted) => 0xc0000022,
        _ => 0xc0000001,
    };
    Error {
        status: status as i32,
        detail: e.to_string(),
        source: Some(std::sync::Arc::new(e)),
    }
}
pub(super) fn mutation_error(e: layerfs_store_service::write::mutation::Result<()>) -> Result<()> {
    e.map_err(|e| coded(&e.code, e.message))
}
pub(super) fn coded(code: &str, message: String) -> Error {
    Error {
        status: match code {
            "NoSuchPath" => 0xc0000034u32,
            "Exists" => 0xc0000035,
            "NotDirectory" => 0xc0000103,
            "NotEmpty" => 0xc0000101,
            "InvalidInput" => 0xc000000d,
            "IsDirectory" => 0xc00000ba,
            "NotFile" => 0xc00000bb,
            _ => 0xc0000001,
        } as i32,
        detail: format!("{code}: {message}"),
        source: None,
    }
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Stat {
    pub serial: u64,
    pub size: u64,
    pub mtime: i64,
    pub nanos: u32,
    pub mode: u32,
    pub directory: u32,
    pub attributes: u32,
}
impl From<ViewStat> for Stat {
    fn from(s: ViewStat) -> Self {
        Self {
            serial: s.serial,
            size: s.logical_len,
            mtime: s.metadata.mtime_seconds,
            nanos: s.metadata.mtime_nanoseconds,
            mode: s.metadata.mode,
            directory: u32::from(
                s.kind == layerfs_content::object::inode_leaf::InodeKind::Directory,
            ),
            attributes: s.windows_attributes,
        }
    }
}
pub(super) fn validate(path: &str) -> Result<()> {
    if path == "/" {
        return Ok(());
    }
    let rest = path
        .strip_prefix('/')
        .ok_or_else(|| refused(0xc000000d, "absolute path required"))?;
    if rest.is_empty() {
        return Err(refused(0xc000000d, "empty path"));
    }
    for name in rest.split('/') {
        layerfs_content::filesystem::PathName::new(name)
            .map_err(|e| refused(0xc000000d, &e.to_string()))?;
        if name.contains([':', '<', '>', '"', '|', '?', '*'])
            || name.chars().any(|c| c < ' ')
            || name.ends_with(['.', ' '])
        {
            return Err(refused(0xc000000d, "unsupported Win32 name"));
        }
        let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
        if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ((base.starts_with("COM") || base.starts_with("LPT"))
                && base.len() == 4
                && matches!(base.as_bytes()[3], b'1'..=b'9'))
        {
            return Err(refused(0xc000000d, "reserved Win32 name"));
        }
    }
    Ok(())
}
