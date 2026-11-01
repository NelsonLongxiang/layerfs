//! Experimental FFI lives here only; no production unsafe allowance is widened.
mod api;
mod callbacks;
mod capture_run;
mod instance;
mod mapped;
mod store_run;
pub use api::ProbeError;
pub use capture_run::{capture_child, capture_live};
pub use instance::{check, live};
pub use store_run::live_store;
