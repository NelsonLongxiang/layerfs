//! Bounded ProjFS feasibility probe, not a LayerFS Workspace implementation.
#![deny(unsafe_code)]
mod fixture;
pub use fixture::{read_window, seed, NAME};
#[cfg(windows)]
pub mod binding_probe;
#[cfg(windows)]
pub mod commit_hold;
#[cfg(windows)]
pub mod commit_reopen;
#[cfg(windows)]
pub mod native_binding;
#[cfg(windows)]
pub mod native_overlay;
#[cfg(windows)]
pub mod saved;
#[cfg(windows)]
mod source;
#[cfg(windows)]
pub mod store_fixture;
#[cfg(windows)]
#[allow(unsafe_code)]
pub mod windows;
