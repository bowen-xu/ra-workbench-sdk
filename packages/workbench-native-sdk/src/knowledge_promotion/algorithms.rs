//! Original algorithm drafts and persisted output contracts. Core owns all storage.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedFoundationsDraft {
    pub paper_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptEvolutionEvent {
    pub ordinal: i64,
    pub concept_id: String,
    pub concept_revision: i64,
    pub concept_label: String,
    pub paper_id: String,
    pub paper_title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued_year: Option<i64>,
    pub assertion_id: String,
    pub assertion_revision: i64,
    pub paper_function: String,
    pub novelty_status: String,
    pub event_kind: String,
    pub explanation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_anchor_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFoundationConcept {
    pub concept_id: String,
    pub concept_revision: i64,
    pub label: String,
    pub weight: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperFoundationSimilarity {
    pub ordinal: i64,
    pub left_paper_id: String,
    pub left_paper_title: String,
    pub right_paper_id: String,
    pub right_paper_title: String,
    pub shared_concepts: Vec<SharedFoundationConcept>,
    pub weighted_jaccard: f64,
    pub shared_concept_count: i64,
    pub left_foundation_count: i64,
    pub right_foundation_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptAlgorithmRun {
    pub id: String,
    pub algorithm_kind: String,
    pub algorithm_id: String,
    pub algorithm_version: i64,
    pub parameters_hash: String,
    pub concept_revision_watermark: i64,
    pub relation_revision_watermark: i64,
    pub paper_scope_hash: String,
    pub status: String,
    pub result_count: i64,
    pub created_at: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    pub evolution_events: Vec<ConceptEvolutionEvent>,
    pub foundation_similarities: Vec<PaperFoundationSimilarity>,
}

/// Two original ID boundaries retain their distinct trimming and byte-count rules in Core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AlgorithmIdKindV1 {
    Evolution,
    Run,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvolutionEventKindV1 {
    Introduced,
    Adapted,
    Reused,
    Unclear,
}
impl EvolutionEventKindV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Introduced => "introduced",
            Self::Adapted => "adapted",
            Self::Reused => "reused",
            Self::Unclear => "unclear",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knowledge_promotion::{
        KnowledgeValidationDecisionV1 as Decision, KnowledgeValidationInputV1 as Input,
    };
    use serde_json::json;

    #[test]
    fn original_run_and_foundation_results_keep_their_wire_fields() {
        let input = json!({
            "id":"run", "algorithmKind":"shared_foundations", "algorithmId":"foundational-concept-weighted-jaccard",
            "algorithmVersion":1, "parametersHash":"parameters", "conceptRevisionWatermark":3,
            "relationRevisionWatermark":4, "paperScopeHash":"scope", "status":"succeeded", "resultCount":1,
            "createdAt":"created", "startedAt":"started", "evolutionEvents":[],
            "foundationSimilarities":[{
                "ordinal":0,"leftPaperId":"left","leftPaperTitle":"Left Ω","rightPaperId":"right",
                "rightPaperTitle":"Right","sharedConcepts":[{"conceptId":"concept","conceptRevision":2,"label":"Concept Ω","weight":0.5}],
                "weightedJaccard":0.25,"sharedConceptCount":1,"leftFoundationCount":2,"rightFoundationCount":3
            }]
        });
        let decoded: ConceptAlgorithmRun = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), input);
        assert!(
            serde_json::from_value::<SharedFoundationsDraft>(
                json!({"paperIds":[],"sql":"select 1"})
            )
            .is_err()
        );
        let event = ConceptEvolutionEvent {
            ordinal: 0,
            concept_id: "concept".into(),
            concept_revision: 1,
            concept_label: "Concept".into(),
            paper_id: "paper".into(),
            paper_title: "Paper".into(),
            issued_year: None,
            assertion_id: "assertion".into(),
            assertion_revision: 2,
            paper_function: "focal".into(),
            novelty_status: "unclear".into(),
            event_kind: "unclear".into(),
            explanation: "Original Ω".into(),
            evidence_anchor_id: None,
        };
        let encoded = serde_json::to_value(event).unwrap();
        assert!(encoded.get("issuedYear").is_none());
        assert!(encoded.get("evidenceAnchorId").is_none());
        assert_eq!(encoded["explanation"], "Original Ω");
    }

    #[test]
    fn evolution_decision_matches_the_original_bounded_chunk_length() {
        let input = Input::EvolutionEvents {
            snapshot_sha256: [3; 32],
            novelty_statuses: vec![Some("pre_existing".into())],
        };
        assert!(input.matches_decision(&Decision::EvolutionEvents {
            result: Ok(vec![EvolutionEventKindV1::Reused])
        }));
        assert!(!input.matches_decision(&Decision::EvolutionEvents { result: Ok(vec![]) }));
        assert!(input.matches_decision(&Decision::EvolutionEvents {
            result: Err("invalid".into())
        }));
        let encoded = serde_json::to_value(&input).unwrap();
        assert_eq!(serde_json::from_value::<Input>(encoded).unwrap(), input);
    }
}
