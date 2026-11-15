use super::{LiteratureMetadataPatch, MetadataCandidateFieldDecision, MetadataCandidateTrust};
use crate::{
    catalog::CatalogItem,
    catalog_save::{CatalogDraft, PreparedDoi},
};
use serde::{Deserialize, Serialize};

/// The original five-column candidate read keeps its raw JSON codec in Core.
/// These are only its other four already decoded fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataCandidateHeaderV1 {
    pub item_id: Option<String>,
    pub source_kind: String,
    pub source_reference: Option<String>,
    pub import_result_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataUpdateInputV1 {
    pub item_id: String,
    pub patch: LiteratureMetadataPatch,
    pub doi: Option<PreparedDoi>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataConfirmInputV1 {
    pub item_id: String,
    pub field_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataFullApplyInputV1 {
    pub candidate_id: String,
    pub header: MetadataCandidateHeaderV1,
    pub candidate: CatalogDraft,
    pub candidate_normalized_doi: String,
    pub draft: CatalogDraft,
    pub doi: PreparedDoi,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataFieldsApplyInputV1 {
    pub candidate_id: String,
    pub header: MetadataCandidateHeaderV1,
    pub candidate: CatalogDraft,
    pub current: CatalogItem,
    pub candidate_doi: PreparedDoi,
    pub current_normalized_doi: String,
    pub decisions: Vec<MetadataCandidateFieldDecision>,
    pub candidate_trust: MetadataCandidateTrust,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataRejectInputV1 {
    pub candidate_id: String,
    pub import_result_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MetadataInputV1 {
    Update {
        input: Box<MetadataUpdateInputV1>,
    },
    Confirm {
        input: Box<MetadataConfirmInputV1>,
    },
    FullApply {
        input: Box<MetadataFullApplyInputV1>,
    },
    FieldsApply {
        input: Box<MetadataFieldsApplyInputV1>,
    },
    Reject {
        input: Box<MetadataRejectInputV1>,
    },
}

/// Public caller parameters exclude Core observations and prepared DOI values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MetadataRequestV1 {
    Update {
        item_id: String,
        patch: LiteratureMetadataPatch,
    },
    Confirm {
        item_id: String,
        field_names: Vec<String>,
    },
    FullApply {
        candidate_id: String,
        draft: Box<CatalogDraft>,
    },
    FieldsApply {
        candidate_id: String,
        decisions: Vec<MetadataCandidateFieldDecision>,
        candidate_trust: MetadataCandidateTrust,
    },
    Reject {
        candidate_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MetadataResultV1 {
    Item { item: Box<CatalogItem> },
    Done {},
}
