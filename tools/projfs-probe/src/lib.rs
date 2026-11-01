//! Bounded ProjFS feasibility probe, not a LayerFS Workspace implementation.
#![deny(unsafe_code)]
mod fixture;
pub use fixture::{read_window, seed, NAME};
#[cfg(windows)]
#[allow(unsafe_code)]
pub mod windows;
