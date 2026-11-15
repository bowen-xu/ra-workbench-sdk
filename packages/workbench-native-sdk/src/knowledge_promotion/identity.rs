//! Original concept identity drafts, snapshots and events. Core retains persistence.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptIdentitySummary {
    pub id: String,
    pub label: String,
    pub revision: i64,
    pub term_count: i64,
    pub definition_count: i64,
    pub source_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptMergeImpact {
    pub survivor: ConceptIdentitySummary,
    pub sources: Vec<ConceptIdentitySummary>,
    pub affected_relation_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptMergeSourceDraft {
    pub id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptMergeDraft {
    pub survivor_id: String,
    pub survivor_expected_revision: i64,
    pub sources: Vec<ConceptMergeSourceDraft>,
    pub rationale: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptSplitDraft {
    pub merge_event_id: String,
    pub source_concept_ids: Vec<String>,
    pub rationale: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptIdentityEvent {
    pub id: String,
    pub operation: String,
    pub survivor: ConceptIdentitySummary,
    pub sources: Vec<ConceptIdentitySummary>,
    pub affected_relation_ids: Vec<String>,
    pub active_source_ids: Vec<String>,
    pub rationale: String,
    pub created_at: String,
}

/// The four original concept-identity consumers, with no SQL or storage authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum IdentityRequestV1 {
    Preview { draft: ConceptMergeDraft },
    Merge { draft: ConceptMergeDraft },
    Split { draft: ConceptSplitDraft },
    List {},
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum IdentityOutputV1 {
    Impact { impact: ConceptMergeImpact },
    Event { event: ConceptIdentityEvent },
    Events { events: Vec<ConceptIdentityEvent> },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn original_identity_drafts_and_event_snapshots_keep_their_wire_fields() {
        let draft = json!({"survivorId":" survivor Ω ","survivorExpectedRevision":-1,"sources":[{"id":"source","expectedRevision":2}],"rationale":" reason "});
        let decoded: ConceptMergeDraft = serde_json::from_value(draft.clone()).unwrap();
        assert_eq!(serde_json::to_value(&decoded).unwrap(), draft);
        let summary = json!({"id":"source","label":"Label Ω","revision":2,"termCount":3,"definitionCount":4,"sourceCount":5});
        let impact =
            json!({"survivor":summary,"sources":[summary],"affectedRelationIds":[" relation "]});
        let decoded: ConceptMergeImpact = serde_json::from_value(impact.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), impact);
        let event = json!({"id":"event","operation":"merge","survivor":summary,"sources":[summary],"affectedRelationIds":[" relation "],"activeSourceIds":["source"],"rationale":" reason ","createdAt":"time"});
        let decoded: ConceptIdentityEvent = serde_json::from_value(event.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), event);
    }
    #[test]
    fn identity_request_envelope_is_finite_and_retains_owned_drafts() {
        let input = json!({"kind":"split","draft":{"mergeEventId":" event ","sourceConceptIds":["source"],"rationale":" Ω "}});
        let decoded: IdentityRequestV1 = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), input);
        assert!(
            serde_json::from_value::<IdentityRequestV1>(json!({"kind":"list","sql":"select 1"}))
                .is_err()
        );
        assert!(serde_json::from_value::<IdentityRequestV1>(json!({"kind":"unknown"})).is_err());
    }
}
