//! Experimental FFI lives here only; no production unsafe allowance is widened.
mod api;
mod callbacks;
mod instance;
pub use api::ProbeError;
pub use instance::{check, live};
