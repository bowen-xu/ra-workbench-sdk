//! Finite original confirmed-unit validation and snapshot interpretation.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum UnitInputV1 {
    Validate {
        title: String,
        body: String,
        unit_kind: String,
        provenance_kind: String,
        epistemic_role: String,
        anchor_count: usize,
    },
    Revision {
        previous_snapshot: Option<Value>,
        current_revision: Option<i64>,
        expected_revision: i64,
    },
    Restore {
        snapshot: Value,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum UnitProblemV1 {
    InvalidInput { message: String },
    NotFound {},
    RevisionConflict { current_revision: i64 },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoredUnitV1 {
    pub project_id: Option<String>,
    pub paper_id: Option<String>,
    pub unit_kind: String,
    pub title: String,
    pub body: String,
    pub provenance_kind: String,
    pub epistemic_role: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoredEvidenceV1 {
    pub anchor_id: String,
    pub stance: String,
    pub rationale: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum UnitDecisionV1 {
    Validated {
        rejection: Option<UnitProblemV1>,
    },
    Revision {
        result: Result<i64, UnitProblemV1>,
    },
    Restore {
        header: Result<RestoredUnitV1, UnitProblemV1>,
        /// Consumed after the original unit UPDATE and evidence DELETE.
        links: Result<Vec<Result<RestoredEvidenceV1, UnitProblemV1>>, UnitProblemV1>,
    },
}

impl UnitInputV1 {
    pub fn matches_decision(&self, decision: &UnitDecisionV1) -> bool {
        matches!(
            (self, decision),
            (Self::Validate { .. }, UnitDecisionV1::Validated { .. })
                | (Self::Revision { .. }, UnitDecisionV1::Revision { .. })
                | (Self::Restore { .. }, UnitDecisionV1::Restore { .. })
        )
    }
}
