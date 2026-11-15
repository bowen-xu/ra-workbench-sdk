//! Finite pure structured validation; candidate bodies remain JSON string leaves.
use crate::candidate_contracts::{CandidateValidationError, EvidenceQuote};
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.structured-validation";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StructuredTargetV1 {
    Portrait,
    Overview,
}
impl StructuredTargetV1 {
    pub fn resource_kind(self) -> &'static str {
        match self {
            Self::Portrait => "portrait",
            Self::Overview => "structuredReading",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructuredValidationInputV1 {
    pub target: StructuredTargetV1,
    /// Already parsed by the caller; no nested Catalog envelope consumes its depth budget.
    pub candidate_json: String,
    /// Original order and duplicate citation keys are significant input bytes.
    pub evidence: Vec<EvidenceQuote>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum StructuredValidationOutcomeV1 {
    Validated {
        input: Box<StructuredValidationInputV1>,
        canonical_json: String,
    },
    Rejected {
        input: Box<StructuredValidationInputV1>,
        error: CandidateValidationError,
    },
}

#[cfg(test)]
mod tests;
