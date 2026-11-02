//! The Linux daemon deployment format has no native Windows process protection.
use layerfs_bridge::daemon_setup::DaemonSetup;
use std::{io, path::Path};
pub(super) fn read(_: &Path) -> io::Result<DaemonSetup> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "Linux daemon configuration requires Unix process protection; use an explicit native Session binding"))
}
