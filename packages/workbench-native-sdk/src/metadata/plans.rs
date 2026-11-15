use super::{
    LiteratureMetadataPatch, MetadataConfirmInputV1, MetadataFieldsApplyInputV1,
    MetadataFullApplyInputV1, MetadataRejectInputV1, MetadataUpdateInputV1,
};
use crate::catalog_save::{CatalogSaveOutcome, PreparedDoi};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MetadataRejectionV1 {
    UnsupportedType { item_type: String },
    EmptyTitle {},
    InvalidFields { reason: String },
    NotFound {},
}

/// Rejections are consumed at the original per-patch transaction position.
/// They do not reject a whole field review before earlier SQL can run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DeferredMetadataPatchV1 {
    Ready {
        patch: LiteratureMetadataPatch,
        doi: Option<PreparedDoi>,
    },
    Rejected {
        error: MetadataRejectionV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataProvenanceV1 {
    pub source_kind: String,
    pub source_reference: Option<String>,
    pub confirmed_by_user: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataUpdateSourcesV1 {
    pub unconfirmed: MetadataProvenanceV1,
    pub otherwise: MetadataProvenanceV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MetadataTitleRuleV1 {
    UnicodeLowercase,
}

/// Consumed using the original actual post-patch title/year read, never a
/// predicted title in this preparation. This is one closed existing rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataDerivationPolicyV1 {
    pub title_rule: MetadataTitleRuleV1,
    pub doi_reason: String,
    pub doi_confidence: f64,
    pub title_reason: String,
    pub title_confidence: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataUpdatePlanV1 {
    pub input: Box<MetadataUpdateInputV1>,
    pub field_name: String,
    pub patch: DeferredMetadataPatchV1,
    pub sources: MetadataUpdateSourcesV1,
    pub derivation: MetadataDerivationPolicyV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataConfirmFieldV1 {
    pub field_name: String,
    pub missing_provenance: MetadataRejectionV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MetadataConfirmOutcomeV1 {
    Ready {
        input: Box<MetadataConfirmInputV1>,
        fields: Vec<MetadataConfirmFieldV1>,
    },
    Rejected {
        input: Box<MetadataConfirmInputV1>,
        error: MetadataRejectionV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataFieldSourceV1 {
    pub field_name: String,
    pub provenance: MetadataProvenanceV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataFullApplyPlanV1 {
    pub input: Box<MetadataFullApplyInputV1>,
    pub save: CatalogSaveOutcome,
    pub field_sources: Vec<MetadataFieldSourceV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "choice",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MetadataPreparedDecisionV1 {
    Candidate {
        field_name: String,
        patch: DeferredMetadataPatchV1,
        provenance: MetadataProvenanceV1,
    },
    Current {
        field_name: String,
        on_missing: MetadataProvenanceV1,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MetadataFieldsApplyOutcomeV1 {
    Ready {
        input: Box<MetadataFieldsApplyInputV1>,
        decisions: Vec<MetadataPreparedDecisionV1>,
        derivation: MetadataDerivationPolicyV1,
    },
    Rejected {
        input: Box<MetadataFieldsApplyInputV1>,
        error: MetadataRejectionV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataRejectPlanV1 {
    pub input: Box<MetadataRejectInputV1>,
    pub zero_affected: MetadataRejectionV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MetadataPreparationV1 {
    Update {
        plan: Box<MetadataUpdatePlanV1>,
    },
    Confirm {
        outcome: MetadataConfirmOutcomeV1,
    },
    FullApply {
        plan: Box<MetadataFullApplyPlanV1>,
    },
    FieldsApply {
        outcome: Box<MetadataFieldsApplyOutcomeV1>,
    },
    Reject {
        plan: MetadataRejectPlanV1,
    },
}
