use super::SourceProbe;
use crate::{nal_annotation::NalAnnotation, nal_state::NalConcept};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BootstrapSourceV1 {
    pub legacy_imported: SourceProbe<bool>,
    pub collections: SourceProbe<Vec<LegacyCollectionV1>>,
    pub relation_types: SourceProbe<Vec<LegacyRelationTypeV1>>,
    pub related_field_used: SourceProbe<bool>,
    pub relations: SourceProbe<Vec<LegacyRelationV1>>,
    pub memberships: SourceProbe<Vec<LegacyMembershipV1>>,
    pub assignments: SourceProbe<Vec<LegacyAssignmentV1>>,
    pub repair_version: SourceProbe<i64>,
    pub repair_records: SourceProbe<Vec<RepairRecordV1>>,
    pub cleanup_exists: SourceProbe<bool>,
    pub raw_state: SourceProbe<RawNalStateV1>,
    pub occupied_name_keys: SourceProbe<Vec<String>>,
    pub configured_embedding: SourceProbe<Option<ConfiguredEmbeddingV1>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyCollectionV1 {
    pub id: String,
    pub name: String,
    pub description: String,
    pub concept_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyRelationTypeV1 {
    pub id: String,
    pub name: String,
    pub inverse_name: String,
    pub directed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyRelationV1 {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub type_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyMembershipV1 {
    pub item_id: String,
    pub collection_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyAssignmentV1 {
    pub item_id: String,
    pub relation_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairRecordV1 {
    pub id: String,
    pub subject_json: String,
    pub predicate_json: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfiguredEmbeddingV1 {
    pub region: String,
    pub model_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawNalStatementV1 {
    pub id: String,
    pub subject_json: String,
    pub predicate_json: String,
    pub origin: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawNalStateV1 {
    pub revision: i64,
    pub concepts: Vec<NalConcept>,
    pub statements: Vec<RawNalStatementV1>,
    pub annotations: Vec<NalAnnotation>,
    pub relation_concept_ids: Vec<String>,
}
