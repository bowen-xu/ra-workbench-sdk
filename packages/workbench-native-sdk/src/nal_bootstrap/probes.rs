use super::{BootstrapPhaseV1, BootstrapStopV1, SourceProbe};
use crate::knowledge_snapshot::KnowledgeTerm;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConceptCallKeyV1 {
    Membership {},
    Tagged {},
    Collection { source_id: String },
    LinkedPredicate {},
    TypePredicate { source_id: String },
    SubFieldPredicate {},
    RepairPredicate {},
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermLookupKeyV1 {
    pub normalized_text: String,
    pub language: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TermValidationV1 {
    Prepared {
        trimmed_text: String,
        normalized_text: String,
        language: String,
    },
    Rejected {
        reason: super::BootstrapRejectionV1,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptIntentV1 {
    pub key: ConceptCallKeyV1,
    pub label: String,
    pub explanation: String,
    pub term: TermValidationV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedSemanticSpaceV1 {
    pub id: String,
    pub region: String,
    pub model_id: String,
    pub dimension: i64,
    pub instruction_set_version: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BootstrapProbePreparationV1 {
    pub concepts: Vec<ConceptIntentV1>,
    pub term_keys: Vec<TermLookupKeyV1>,
    pub statement_count: usize,
    pub representation_render_version: String,
    pub semantic_namespace: String,
    pub semantic_space: SourceProbe<Option<PreparedSemanticSpaceV1>>,
    pub earliest_unavailable: Option<BootstrapPhaseV1>,
    pub terminal: Option<BootstrapStopV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermLookupFactV1 {
    pub key: TermLookupKeyV1,
    pub result: SourceProbe<Option<KnowledgeTerm>>,
    pub failure_phase: Option<BootstrapPhaseV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExistingGenerationV1 {
    pub id: String,
    pub embedding_space_id: String,
    pub generation: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptSemanticFactV1 {
    pub key: ConceptCallKeyV1,
    pub representation: SourceProbe<Option<String>>,
    pub queue_job: SourceProbe<Option<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BootstrapProbeFactsV1 {
    pub terms: Vec<TermLookupFactV1>,
    pub generation: SourceProbe<Option<ExistingGenerationV1>>,
    pub next_generation: SourceProbe<i64>,
    pub concepts: Vec<ConceptSemanticFactV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptIdentitySlotsV1 {
    pub key: ConceptCallKeyV1,
    pub term_id: String,
    pub term_revision_id: String,
    pub concept_id: String,
    pub concept_revision_id: String,
    pub representation_id: String,
    pub record_id: String,
    pub job_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BootstrapIdentitiesV1 {
    pub concepts: Vec<ConceptIdentitySlotsV1>,
    pub generation_id: Option<String>,
    pub statement_ids: Vec<String>,
}
