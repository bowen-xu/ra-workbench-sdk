//! Finite annotation preparations; Core retains notes and transaction ownership.
use crate::{
    nal_annotation::{NalAnnotation, NalAnnotationRequest},
    nal_bootstrap::{BootstrapInputV1, BootstrapPreparationV1},
};
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.nal-annotation";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum NalAnnotationValidation {
    Valid {},
    InvalidRequest {},
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalAnnotationIdentities {
    pub page_id: String,
    pub annotation_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalAnnotationPrepareInput {
    pub bootstrap: BootstrapInputV1,
    pub request: NalAnnotationRequest,
    pub identities: NalAnnotationIdentities,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalAnnotationPreparation {
    pub bootstrap: BootstrapPreparationV1,
    pub decision: NalAnnotationDecision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalAnnotationDecision {
    DeferredAfterBootstrap {},
    Existing {
        annotation: NalAnnotation,
    },
    TargetMissing {},
    Create {
        annotation: NalAnnotation,
        raw_title: String,
        link: NalAnnotationLinkPreparation,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NalAnnotationBeforeLoadRejection {
    InvalidAnnotationId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NalAnnotationAfterLoadRejection {
    IdentityConflict,
    TargetConflict,
}

/// These stages do not authorize skipping the second complete state load.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalAnnotationLinkPreparation {
    RejectedBeforeLoad {
        reason: NalAnnotationBeforeLoadRejection,
    },
    AfterLoadRejected {
        annotations: Vec<NalAnnotation>,
        reason: NalAnnotationAfterLoadRejection,
    },
    ReadActive {
        annotations: Vec<NalAnnotation>,
        target: NalAnnotationLinkTarget,
    },
}

/// The caller checks the actual Core note's active state before this selection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalAnnotationLinkTarget {
    Concept { id: String },
    Statement { id: String },
    InvalidTargetKind {},
}

#[cfg(test)]
mod tests;
