//! Experimental FFI lives here only; no production unsafe allowance is widened.
mod api;
mod callbacks;
mod instance;
mod store_run;
pub use api::ProbeError;
pub use instance::{check, live};
pub use store_run::live_store;
