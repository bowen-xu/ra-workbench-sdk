//! Finite original item lifecycle inputs; no persistence or execution owner.
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.lifecycle";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LifecycleRequestV1 {
    Archive {
        item_id: String,
    },
    Restore {
        item_id: String,
    },
    Trash {
        item_id: String,
    },
    RestoreTrash {
        item_id: String,
    },
    TrashMany {
        item_ids: Vec<String>,
    },
    SetProjects {
        item_id: String,
        project_ids: Vec<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleRejectionCodeV1 {
    NotFound,
}

impl LifecycleRejectionCodeV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LifecycleRejectionV1 {
    pub code: LifecycleRejectionCodeV1,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LifecyclePreparationV1 {
    Ready {
        request: LifecycleRequestV1,
        /// Only TrashMany has an ordered, deduplicated execution vector.
        /// Its original request remains unchanged for exact input binding.
        trash_item_ids: Vec<String>,
    },
    Rejected {
        error: LifecycleRejectionV1,
    },
}

#[cfg(test)]
mod tests;
