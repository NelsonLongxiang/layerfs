//! Safe process-local Windows Workspace session. OS mounting and ABI remain separate.
mod binding;
mod commit;
mod coordination;
mod handles;
mod lifecycle;
mod metadata;
mod names;
mod operations;
mod session;
mod startup;
mod types;
pub use binding::Binding;
pub use commit::{CommitCompletion, CommitReceipt, CommitWork};
pub use lifecycle::{CloseState, SessionStatus};
pub use session::Session;
pub use startup::{BindCause, BindFailure, BindPhase};
pub use types::{failed, refused, CommitScope, Error, Result, Stat};
