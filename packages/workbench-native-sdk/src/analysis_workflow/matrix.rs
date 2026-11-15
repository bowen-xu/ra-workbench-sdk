//! Finite original matrix context and evidence decisions over owned observations.
use super::AnalysisWorkflowError;
use crate::{
    evidence_matrix::EvidenceMatrixCellDraft,
    generation::evidence::{AiEvidencePreview, AnchorEvidence},
    generation::{AiMatrixSynthesisContext, AiMatrixSynthesisContextDraft, DerivedViewInputRef},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatrixCellObservationV1 {
    pub paper_id: String,
    pub snapshot: EvidenceMatrixCellDraft,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MatrixContextInputV1 {
    Header {
        draft: AiMatrixSynthesisContextDraft,
    },
    Revision {
        matches: bool,
    },
    Input {
        input: DerivedViewInputRef,
        prior_cell_ids: Vec<String>,
    },
    Coverage {
        snapshot: EvidenceMatrixCellDraft,
    },
    Finish {
        draft: AiMatrixSynthesisContextDraft,
        cells: Vec<MatrixCellObservationV1>,
        scope: Vec<(String, String)>,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MatrixContextDecisionV1 {
    Validated {
        rejection: Option<AnalysisWorkflowError>,
    },
    Resolved {
        result: Result<AiMatrixSynthesisContext, AnalysisWorkflowError>,
    },
}
impl MatrixContextInputV1 {
    pub fn matches_decision(&self, decision: &MatrixContextDecisionV1) -> bool {
        match (self, decision) {
            (Self::Finish { draft, scope, .. }, MatrixContextDecisionV1::Resolved { result }) => {
                result.as_ref().is_ok_and(|context| {
                    context.project_id == draft.project_id
                        && context.matrix_id == draft.matrix_id
                        && context.matrix_revision == draft.matrix_revision
                        && context.view_kind == draft.view_kind
                        && context.inputs == draft.inputs
                        && context.title == draft.title.trim()
                        && context.scope_note == draft.scope_note.trim()
                        && context
                            .evidence_anchor_ids
                            .iter()
                            .eq(scope.iter().map(|(_, id)| id))
                }) || result.is_err()
            }
            (Self::Finish { .. }, _) => false,
            (_, MatrixContextDecisionV1::Validated { .. }) => true,
            _ => false,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MatrixEvidenceInputV1 {
    Anchor {
        source: Option<AnchorEvidence>,
    },
    Sources {
        sources: Vec<AnchorEvidence>,
    },
    FrozenHash {
        expected: Option<String>,
        actual: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MatrixEvidenceDecisionV1 {
    Validated {
        rejection: Option<AnalysisWorkflowError>,
    },
    Preview {
        result: Result<Vec<AiEvidencePreview>, AnalysisWorkflowError>,
    },
}
impl MatrixEvidenceInputV1 {
    pub fn matches_decision(&self, decision: &MatrixEvidenceDecisionV1) -> bool {
        match (self, decision) {
            (Self::Sources { sources }, MatrixEvidenceDecisionV1::Preview { result }) => {
                result.as_ref().is_ok_and(|rows| {
                    rows.len() == sources.len()
                        && rows.iter().zip(sources).all(|(row, source)| {
                            row.anchor_id == source.anchor_id
                                && row.attachment_id == source.attachment_id
                                && row.content_sha256 == source.content_sha256
                                && row.quote_exact == source.quote_exact
                                && row.paper_title == source.paper_title
                                && row.page_index == source.page_index
                                && row.page_label == source.page_label
                        })
                }) || result.is_err()
            }
            (Self::Sources { .. }, _) => false,
            (_, MatrixEvidenceDecisionV1::Validated { .. }) => true,
            _ => false,
        }
    }
}
