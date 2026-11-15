//! Original derived-view input values and finite validation observations.
use crate::{evidence_matrix::EvidenceMatrixCellDraft, generation::DerivedViewInputRef};
use serde::{Deserialize, Serialize};
pub mod manual;
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DerivedViewItem {
    pub id: String,
    pub text: String,
    pub epistemic_role: String,
    pub evidence_anchor_ids: Vec<String>,
    pub has_conflict: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DerivedResearchViewDraft {
    pub id: Option<String>,
    pub project_id: String,
    pub view_kind: String,
    pub title: String,
    #[serde(default)]
    pub scope_note: String,
    pub inputs: Vec<DerivedViewInputRef>,
    pub items: Vec<DerivedViewItem>,
    pub review_state: String,
    pub expected_revision: Option<i64>,
    pub change_reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedDerivedViewV1 {
    pub project_id: String,
    pub view_kind: String,
    pub title: String,
    pub scope_note: String,
    pub inputs: Vec<DerivedViewInputRef>,
    pub items: Vec<DerivedViewItem>,
    pub provenance_kind: String,
    pub provider_id: String,
    pub model_id: String,
    pub generated_at: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DerivedValidationInputV1 {
    Provenance {
        provenance_kind: String,
    },
    Header {
        draft: DerivedResearchViewDraft,
    },
    Input {
        ordinal: usize,
        input: DerivedViewInputRef,
    },
    Coverage {
        ordinal: usize,
        snapshot: EvidenceMatrixCellDraft,
    },
    Item {
        ordinal: usize,
        view_kind: String,
        item: DerivedViewItem,
        allowed_anchors: Vec<String>,
    },
}
impl DerivedValidationInputV1 {
    pub fn same_rule(&self, other: &Self) -> bool {
        use DerivedValidationInputV1::*;
        match (self, other) {
            (Provenance { .. }, Provenance { .. }) | (Header { .. }, Header { .. }) => true,
            (Input { ordinal: a, .. }, Input { ordinal: b, .. })
            | (Coverage { ordinal: a, .. }, Coverage { ordinal: b, .. })
            | (Item { ordinal: a, .. }, Item { ordinal: b, .. }) => a == b,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DerivedResearchView {
    pub id: String,
    pub project_id: String,
    pub view_kind: String,
    pub title: String,
    pub scope_note: String,
    pub inputs: Vec<DerivedViewInputRef>,
    pub items: Vec<DerivedViewItem>,
    pub review_state: String,
    pub provenance_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub generated_at: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}
