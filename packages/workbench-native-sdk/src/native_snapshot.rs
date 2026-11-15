//! Request-bound payload identity. File creation and cleanup remain with callers.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotRef {
    pub relative_handle: String,
    pub byte_size: u64,
    pub sha256: String,
    pub package_key: String,
    pub instance_id: String,
    pub request_id: String,
}

impl SnapshotRef {
    /// Transfer identity only. It grants no database or file authority.
    pub fn matches(&self, handle: &str, package: &str, instance: &str, request: &str) -> bool {
        self.relative_handle == handle
            && self.byte_size != 0
            && crate::wire::is_digest(&self.sha256)
            && self.package_key == package
            && self.instance_id == instance
            && self.request_id == request
    }
}
