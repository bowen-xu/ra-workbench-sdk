//! Original public retrieval DTOs. They own no query, clock or provider.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptRetrievalPreviewDraft {
    pub client_request_id: String,
    pub paper_id: Option<String>,
    pub query: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptRetrievalSeed {
    pub concept_id: String,
    pub concept_revision: i64,
    pub label: String,
    pub preferred_term: String,
    pub matched_by: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lexical_rank: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vector_rank: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vector_distance: Option<f32>,
    pub rrf_score: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptRetrievalEdge {
    pub relation_assertion_id: String,
    pub relation_revision: i64,
    pub subject_concept_id: String,
    pub subject_label: String,
    pub predicate_kind: String,
    pub object_concept_id: String,
    pub object_label: String,
    pub hop: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptRetrievalSource {
    pub anchor_id: String,
    pub concept_id: String,
    pub concept_label: String,
    pub paper_id: String,
    pub paper_title: String,
    pub source_kind: String,
    pub source_subject_id: String,
    pub source_subject_revision: i64,
    pub page_index: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_label: Option<String>,
    pub quote_exact: String,
    pub context_text: String,
    pub selected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub omission_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptRetrievalPreview {
    pub trace_id: String,
    pub semantic_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_space_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index_generation_id: Option<String>,
    pub seeds: Vec<ConceptRetrievalSeed>,
    pub edges: Vec<ConceptRetrievalEdge>,
    pub sources: Vec<ConceptRetrievalSource>,
    pub selected_source_count: i64,
    pub external_paper_count: i64,
    pub context_sha256: String,
    pub expires_at: String,
}

/// Original ordered lexical hit before seed fusion.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LexicalHitV1 {
    pub concept_id: String,
    pub rank: i64,
}

/// Core observed the original vector-membership query for this ordered hit.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorObservationV1 {
    pub concept_id: String,
    pub subject_revision: i64,
    pub distance_bits: u32,
    pub valid: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateRankV1 {
    pub concept_id: String,
    pub lexical_rank: Option<i64>,
    pub vector_rank: Option<i64>,
    pub vector_distance_bits: Option<u32>,
    pub vector_revision: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptIdentityV1 {
    pub revision: i64,
    pub label: String,
    pub preferred_term: String,
}

pub const CAPABILITY_ID: &str = "literature.concept-retrieval";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorTargetV1 {
    pub embedding_space_id: String,
    pub index_generation_id: String,
    pub relative_database_path: String,
    pub dimension: usize,
    pub model_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphEdgeObservationV1 {
    pub relation_assertion_id: String,
    pub relation_revision: i64,
    pub subject_concept_id: String,
    pub subject_label: String,
    pub predicate_kind: String,
    pub object_concept_id: String,
    pub object_label: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceObservationV1 {
    pub anchor_id: String,
    pub concept_id: String,
    pub concept_label: String,
    pub paper_id: String,
    pub paper_title: String,
    pub source_subject_id: String,
    pub source_subject_revision: i64,
    pub page_index: i64,
    pub page_label: Option<String>,
    pub quote_exact: String,
    pub text: String,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "stage", rename_all = "camelCase", deny_unknown_fields)]
pub enum ConceptRetrievalInputV1 {
    ValidateDraft {
        draft: ConceptRetrievalPreviewDraft,
    },
    ValidatePaper {
        exists: bool,
    },
    RankCandidates {
        lexical_ids: Vec<String>,
        vector_hits: Vec<VectorObservationV1>,
    },
    SelectSeeds {
        candidates: Vec<(CandidateRankV1, Option<ConceptIdentityV1>)>,
    },
    ProjectGraph {
        seed_ids: Vec<String>,
        edges: Vec<GraphEdgeObservationV1>,
    },
    ProjectSources {
        paper_id: Option<String>,
        seeds: Vec<ConceptRetrievalSeed>,
        edges: Vec<ConceptRetrievalEdge>,
        definitions: Vec<SourceObservationV1>,
        usages: Vec<SourceObservationV1>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "stage", rename_all = "camelCase", deny_unknown_fields)]
pub enum ConceptRetrievalDecisionV1 {
    Rejected {
        message: String,
    },
    Query {
        query: String,
        fts_query: String,
        query_sha256: String,
    },
    PaperValidated,
    Candidates {
        candidates: Vec<CandidateRankV1>,
    },
    Seeds {
        seeds: Vec<ConceptRetrievalSeed>,
    },
    Graph {
        edges: Vec<ConceptRetrievalEdge>,
        concept_ids: Vec<String>,
    },
    Trace {
        sources: Vec<ConceptRetrievalSource>,
        selected_source_count: i64,
        external_paper_count: i64,
        context_text: String,
        context_sha256: String,
        config_json: String,
    },
}

/// Reuse the existing typed CBOR transport to retain exact floating values.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptRetrievalWireInputV1 {
    pub cbor_base64: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptRetrievalWireOutcomeV1 {
    pub input: Box<ConceptRetrievalWireInputV1>,
    pub decision_cbor_base64: String,
}

/// Original stored-DTO decoding constraints, shared by both IO adapters.
pub fn decode_trace_match_kinds(value: &str) -> Result<Vec<String>, &'static str> {
    let matched =
        serde_json::from_str::<Vec<String>>(value).map_err(|_| "检索 trace 的匹配方式已损坏")?;
    if matched.is_empty()
        || matched
            .iter()
            .any(|value| !matches!(value.as_str(), "lexical" | "vector"))
    {
        return Err("检索 trace 的匹配方式无效");
    }
    Ok(matched)
}

pub fn validate_trace_semantic_status(value: &str) -> Result<(), &'static str> {
    if matches!(value, "used" | "unavailable") {
        Ok(())
    } else {
        Err("检索 trace 的语义状态无效")
    }
}

pub fn validate_trace_id(id: &str) -> Result<(), &'static str> {
    if id.trim().is_empty() || id.len() > 160 {
        Err("概念网络检索 trace ID 无效")
    } else {
        Ok(())
    }
}
