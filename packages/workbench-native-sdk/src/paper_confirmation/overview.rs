//! Finite original overview qualification and selected field values.
use crate::candidate_contracts::PaperOverviewPayload;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualifiedOverviewV1 {
    pub paper_id: String,
    pub overview: PaperOverviewPayload,
    pub populated_field_count: usize,
}
