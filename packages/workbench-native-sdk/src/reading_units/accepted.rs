//! Original owned equivalent of the borrowed AI-reviewed reading-unit draft.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedReadingUnitV1 {
    pub project_id: Option<String>,
    pub paper_id: String,
    pub unit_kind: String,
    pub title: String,
    pub body: String,
    pub provenance_kind: String,
    pub epistemic_role: String,
    pub anchor_ids: Vec<String>,
    pub candidate_id: String,
    pub candidate_revision: i64,
}
