//! Original shared candidate and evidence DTOs. Core retains storage and history.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEvidenceBundle {
    pub id: String,
    pub run_id: String,
    pub scope_hash: String,
    pub retrieval_config_version: String,
    pub validation_status: String,
    pub created_at: String,
    pub items: Vec<AiEvidenceItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEvidenceItem {
    pub id: String,
    pub citation_key: String,
    pub ordinal: i64,
    pub anchor_id: String,
    pub paper_id: String,
    pub paper_title: String,
    pub attachment_id: String,
    pub content_sha256: String,
    pub page_index: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_label: Option<String>,
    pub quote_exact: String,
    pub quote_prefix: String,
    pub quote_suffix: String,
    pub context_text: String,
    pub relation_kind: String,
    pub validation_status: String,
    pub current_anchor_status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCitationAssessment {
    pub id: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub statement_id: String,
    pub evidence_item_id: String,
    pub assessment_revision: i64,
    pub semantic_relation: String,
    pub rationale: String,
    pub idempotency_key: String,
    pub assessed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCitationAssessmentDraft {
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub statement_id: String,
    pub evidence_item_id: String,
    pub expected_assessment_revision: i64,
    pub semantic_relation: String,
    pub rationale: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCandidateRevision {
    pub id: String,
    pub revision: i64,
    pub payload: serde_json::Value,
    pub payload_hash: String,
    pub editor_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_revision: Option<i64>,
    pub change_reason: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewDecision {
    pub id: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub action: String,
    pub rationale: String,
    pub idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_object_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_object_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_object_revision: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttentionFeedback {
    pub id: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub suggestion_id: String,
    pub feedback_kind: String,
    pub note: String,
    pub idempotency_key: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionItemDecision {
    pub id: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub suggestion_id: String,
    pub action: String,
    pub resolution_kind: String,
    pub rationale: String,
    pub idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_object_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_object_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_object_revision: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCandidateSummaryVersion {
    pub id: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub version: i64,
    pub summary: String,
    pub source_kind: String,
    pub is_selected: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discarded_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCandidate {
    pub id: String,
    pub run_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub candidate_kind: String,
    pub schema_version: i64,
    pub current_revision: i64,
    pub review_state: String,
    pub validation_status: String,
    pub original_payload_hash: String,
    pub created_at: String,
    pub updated_at: String,
    pub evidence_bundle: AiEvidenceBundle,
    pub revisions: Vec<AiCandidateRevision>,
    pub decisions: Vec<AiReviewDecision>,
    pub attention_feedback: Vec<AiAttentionFeedback>,
    pub suggestion_item_decisions: Vec<AiSuggestionItemDecision>,
    pub citation_assessments: Vec<AiCitationAssessment>,
    pub inspected_evidence_item_ids: Vec<String>,
    pub overview_field_confirmations: Vec<AiOverviewFieldConfirmation>,
    pub summary_versions: Vec<AiCandidateSummaryVersion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiOverviewFieldConfirmation {
    pub id: String,
    pub batch_id: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub field_kind: String,
    pub field_payload_hash: String,
    pub decision_kind: String,
    pub target_reading_unit_id: String,
    pub target_applied_revision: i64,
    pub active: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undone_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_reset_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCandidateRevisionDraft {
    pub candidate_id: String,
    pub expected_revision: i64,
    pub payload: serde_json::Value,
    pub change_reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewDecisionDraft {
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub action: String,
    pub rationale: String,
    pub idempotency_key: String,
    pub reading_unit_title: Option<String>,
    pub project_id: Option<String>,
}

#[cfg(test)]
mod tests;

/// Bounded current-state facts for review decisions over the retained history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenericCandidateObservation {
    pub candidate_kind: String,
    pub current_revision: i64,
    pub review_state: String,
    pub has_active_confirmations: bool,
    pub has_revision_item_decisions: bool,
    pub current_editor_kind: Option<String>,
}
impl AiCandidate {
    pub fn review_observation(&self, requested_revision: i64) -> GenericCandidateObservation {
        GenericCandidateObservation {
            candidate_kind: self.candidate_kind.clone(),
            current_revision: self.current_revision,
            review_state: self.review_state.clone(),
            has_active_confirmations: self
                .overview_field_confirmations
                .iter()
                .any(|item| item.active),
            has_revision_item_decisions: self
                .suggestion_item_decisions
                .iter()
                .any(|item| item.candidate_revision == requested_revision),
            current_editor_kind: self
                .revisions
                .iter()
                .find(|item| item.revision == self.current_revision)
                .map(|item| item.editor_kind.clone()),
        }
    }
}
