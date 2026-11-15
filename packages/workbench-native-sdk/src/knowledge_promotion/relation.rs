//! Original manual relation codecs and finite observations, with no storage owner.
use super::models::RelationNodeSummary;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationNodeRef {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationAssertionDraft {
    pub id: Option<String>,
    pub project_id: Option<String>,
    pub subject: RelationNodeRef,
    pub predicate_kind: String,
    pub object: RelationNodeRef,
    pub scope_note: String,
    pub anchor_id: Option<String>,
    pub evidence_stance: Option<String>,
    pub evidence_rationale: Option<String>,
    pub expected_revision: Option<i64>,
    pub change_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationAssertion {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_title: Option<String>,
    pub subject: RelationNodeSummary,
    pub predicate_kind: String,
    pub object: RelationNodeSummary,
    pub scope_note: String,
    pub provenance_kind: String,
    pub epistemic_role: String,
    pub revision: i64,
    pub evidence_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationNodeKindV1 {
    Concept,
    DefinitionClaim,
    ReadingUnit,
    Paper,
    NotePage,
}
impl RelationNodeKindV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Concept => "concept",
            Self::DefinitionClaim => "definition_claim",
            Self::ReadingUnit => "reading_unit",
            Self::Paper => "paper",
            Self::NotePage => "note_page",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelationDraftFactsV1 {
    pub predicate_kind: String,
    pub scope_characters: usize,
    pub reason_characters: Option<usize>,
    pub rationale_characters: Option<usize>,
    pub anchor_present: bool,
    pub evidence_stance: Option<String>,
    pub rationale_is_empty: bool,
}
impl RelationDraftFactsV1 {
    pub fn observe(draft: &RelationAssertionDraft) -> Self {
        Self {
            // Every original accepted token has fewer than 64 characters.
            // Retain the full draft in Core and bound only this rule observation.
            predicate_kind: draft.predicate_kind.chars().take(64).collect(),
            scope_characters: draft.scope_note.chars().count(),
            reason_characters: draft.change_reason.as_ref().map(|s| s.chars().count()),
            rationale_characters: draft.evidence_rationale.as_ref().map(|s| s.chars().count()),
            anchor_present: draft.anchor_id.is_some(),
            evidence_stance: draft
                .evidence_stance
                .as_ref()
                .map(|value| value.chars().take(64).collect()),
            rationale_is_empty: draft
                .evidence_rationale
                .as_ref()
                .is_none_or(|s| s.trim().is_empty()),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelationSearchPlanV1 {
    pub kinds: [RelationNodeKindV1; 5],
    pub final_limit: usize,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RelationRevisionRejectionV1 {
    NewExpectedRevision,
    MissingExpectedRevision,
    Conflict { current_revision: i64 },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn original_relation_draft_wire_keeps_nulls_and_output_omits_absent_project() {
        let input = json!({"id":null,"projectId":null,"subject":{"kind":"paper","id":" paper "},"predicateKind":"related_to","object":{"kind":"note_page","id":"note"},"scopeNote":" Ω ","anchorId":null,"evidenceStance":null,"evidenceRationale":null,"expectedRevision":null,"changeReason":null});
        let draft: RelationAssertionDraft = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(&draft).unwrap(), input);
        let saved = RelationAssertion {
            id: "relation".into(),
            project_id: None,
            project_title: None,
            subject: RelationNodeSummary {
                kind: draft.subject.kind,
                id: draft.subject.id,
                label: "Paper".into(),
                detail: String::new(),
            },
            predicate_kind: draft.predicate_kind,
            object: RelationNodeSummary {
                kind: draft.object.kind,
                id: draft.object.id,
                label: "Note".into(),
                detail: String::new(),
            },
            scope_note: draft.scope_note,
            provenance_kind: "human_original".into(),
            epistemic_role: "assertion".into(),
            revision: 1,
            evidence_count: 0,
            created_at: "created".into(),
            updated_at: "updated".into(),
        };
        let output = serde_json::to_value(saved).unwrap();
        assert!(output.get("projectId").is_none());
        assert!(output.get("projectTitle").is_none());
        assert_eq!(output["subject"]["id"], " paper ");
        assert_eq!(output["scopeNote"], " Ω ");
    }
    #[test]
    fn finite_observation_preserves_unicode_counts_and_bounds_only_token_observations() {
        let mut draft:RelationAssertionDraft=serde_json::from_value(json!({"subject":{"kind":"paper","id":"paper"},"predicateKind":"related_to","object":{"kind":"note_page","id":"note"},"scopeNote":"界".repeat(4_001),"evidenceRationale":" Ω "})).unwrap();
        let observed = RelationDraftFactsV1::observe(&draft);
        assert_eq!(observed.scope_characters, 4_001);
        assert_eq!(observed.rationale_characters, Some(3));
        assert!(!observed.rationale_is_empty);
        draft.predicate_kind = "界".repeat(100_000);
        draft.evidence_stance = Some("stance".repeat(100_000));
        let observed = RelationDraftFactsV1::observe(&draft);
        assert_eq!(observed.predicate_kind.chars().count(), 64);
        assert_eq!(observed.evidence_stance.unwrap().chars().count(), 64);
        assert_eq!(draft.predicate_kind.chars().count(), 100_000);
        assert_eq!(
            draft.evidence_stance.unwrap().len(),
            "stance".len() * 100_000
        );
    }
}
