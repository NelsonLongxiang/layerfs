//! Native Windows filesystem owner. Commands execute outside this service.
#[cfg(windows)]
fn main() -> std::process::ExitCode {
    layerfs_daemon::native::process::main()
}
#[cfg(not(windows))]
fn main() -> std::process::ExitCode {
    eprintln!("native Windows filesystem service is unsupported on this platform");
    std::process::ExitCode::FAILURE
}
