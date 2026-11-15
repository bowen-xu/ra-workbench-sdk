//! Static permanent-cleanup policy data. No row identities or execution steps.
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.trash-cleanup";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupRelationV1 {
    pub id: String,
    pub child: String,
    pub parent: String,
}

/// The reviewed static plan is bound by Core before it authorizes scope values.
/// It contains no SQL, rowids, data-dependent branches or arbitrary steps.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupPlanV1 {
    pub soft_owners: Vec<String>,
    pub relations: Vec<CleanupRelationV1>,
    pub delete_tables: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanupPlanRejectionCodeV1 {
    PlanCycle,
}

impl CleanupPlanRejectionCodeV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PlanCycle => "LITERATURE_CLEANUP_PLAN_CYCLE",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TrashCleanupPreparationV1 {
    Ready { plan: CleanupPlanV1 },
    Rejected { code: CleanupPlanRejectionCodeV1 },
}

#[cfg(test)]
mod tests;
