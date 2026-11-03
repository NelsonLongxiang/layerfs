//! `branch.delete`.
use crate::base::args::{invalid, project, text, Answer};
use layerfs_bridge::control::SdkValue;
use layerfs_store_service::{
    history::{branch, lookup},
    StoreService,
};

/// `delete({ branch, force? })`: removes one Branch row; main and Branches
/// main does not reach are refused unless `force`, and a Branch a published
/// Layer names is always refused.
pub fn delete(service: &StoreService, args: &SdkValue) -> Answer {
    let stack = project(service, args)?;
    let name = text(args, "branch")?;
    if name == branch::MAIN {
        return Err(invalid("main cannot be deleted"));
    }
    let named = lookup::branch(&service.store, &stack, name)?;
    let force = matches!(args.get("force"), Some(SdkValue::Bool(true)));
    branch::delete(&service.store, &stack, &named, force)
}
