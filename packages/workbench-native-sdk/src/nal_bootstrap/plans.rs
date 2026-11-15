use super::{
    ConceptCallKeyV1, PreparedSemanticSpaceV1, RawNalStateV1, RawNalStatementV1, SourceProbe,
};
use crate::knowledge_snapshot::KnowledgeTerm;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BootstrapRejectionV1 {
    EmptyTerm,
    TermTooLong,
    InvalidNameLength,
    EmptyNameContext,
    ConceptFieldsTooLong,
    NameUnavailable,
    InvalidStructure,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BootstrapStopReasonV1 {
    Deferred {},
    Rejected { reason: BootstrapRejectionV1 },
    InvalidBinding {},
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BootstrapStopV1 {
    pub phase: super::BootstrapPhaseV1,
    pub concept_key: Option<ConceptCallKeyV1>,
    pub statement_id: Option<String>,
    pub reason: BootstrapStopReasonV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TermResolutionV1 {
    Existing {
        term: KnowledgeTerm,
    },
    Create {
        id: String,
        text: String,
        normalized_text: String,
        language: String,
        revision_id: String,
    },
    Planned {
        id: String,
        text: String,
        normalized_text: String,
        language: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedConceptDetailsV1 {
    pub label: String,
    pub explanation: String,
    pub disambiguation: String,
    pub domain: String,
    pub tradition: String,
    pub period: String,
    pub rejection: Option<BootstrapRejectionV1>,
    pub available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedRepresentationV1 {
    pub id: String,
    pub existing: bool,
    pub rendered_text: String,
    pub input_sha256: String,
    pub render_version: String,
    pub language: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedGenerationV1 {
    pub id: String,
    pub embedding_space_id: String,
    pub generation: i64,
    pub create: bool,
    pub relative_database_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QueueResolutionV1 {
    Existing {
        job_id: String,
    },
    Create {
        record_id: String,
        job_id: String,
        row_id: String,
        idempotency_key: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedSemanticQueueV1 {
    pub space: PreparedSemanticSpaceV1,
    pub generation: PreparedGenerationV1,
    pub job: QueueResolutionV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedConceptV1 {
    pub key: ConceptCallKeyV1,
    pub term: SourceProbe<TermResolutionV1>,
    pub concept_id: String,
    pub concept_revision_id: String,
    pub name_checks: Vec<NameCheckV1>,
    pub details: SourceProbe<PreparedConceptDetailsV1>,
    pub representation: SourceProbe<PreparedRepresentationV1>,
    pub semantic_generation: SourceProbe<PreparedGenerationV1>,
    pub semantic_queue: SourceProbe<Option<PreparedSemanticQueueV1>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NameCheckV1 {
    pub candidate: String,
    pub exists: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectionBindingV1 {
    pub source_id: String,
    pub concept_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TypePredicateBindingV1 {
    pub source_id: String,
    pub concept_id: String,
    pub directed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ImportPreparationV1 {
    Skipped {},
    Prepared(Box<PreparedImportV1>),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedImportV1 {
    pub membership: Option<String>,
    pub tagged: Option<String>,
    pub collections: Vec<CollectionBindingV1>,
    pub linked_predicate: Option<String>,
    pub type_predicates: Vec<TypePredicateBindingV1>,
    pub related_field_probe: Option<RelatedFieldProbeV1>,
    pub subfield_predicate: Option<String>,
    pub linked_statements: Vec<PreparedNalStatementV1>,
    pub relation_statements: Vec<PreparedNalStatementV1>,
    pub membership_statements: Vec<PreparedNalStatementV1>,
    pub assignment_statements: Vec<PreparedNalStatementV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelatedFieldProbeV1 {
    pub source_id: String,
    pub result: SourceProbe<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedNalStatementV1 {
    pub statement: RawNalStatementV1,
    pub relation_concept_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RepairPreparationV1 {
    Skipped {},
    Prepared {
        relation: Option<String>,
        rewrites: Vec<RawNalStatementV1>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CleanupPreparationV1 {
    Skipped {},
    Prepared {
        delete_ids: Vec<String>,
        expected_post_repair: RawNalStateV1,
    },
    DecodeAtOriginalPoint {},
    Deferred {},
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum StateProjectionV1 {
    Prepared {
        raw_state: RawNalStateV1,
        rules: Vec<crate::nal_state::NalRule>,
    },
    DecodeAtOriginalPoint {},
    Deferred {},
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BootstrapPreparationV1 {
    pub concepts: Vec<PreparedConceptV1>,
    pub import: ImportPreparationV1,
    pub repair: RepairPreparationV1,
    pub cleanup: CleanupPreparationV1,
    pub final_projection: StateProjectionV1,
    pub terminal: Option<BootstrapStopV1>,
}
