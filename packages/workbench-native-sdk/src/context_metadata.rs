//! Original Agent metadata projection over captured values, without I/O owners.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CAPABILITY_ID: &str = "literature.context-metadata";
pub const CAPABILITY_VERSION: u32 = 1;

/// Core preserves the original SQL, decoding order and authorization before
/// passing these values to the unique literature projection.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextMetadataInputV1 {
    pub paper_id: String,
    pub base: Value,
    pub creators: Vec<[String; 2]>,
    pub identifiers: Vec<[String; 2]>,
}

/// Encoded with the existing bounded CBOR/base64 payload codec. Echoing the
/// complete leaf binds the result to the caller's exact captured input.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextMetadataRequestV1 {
    pub cbor_base64: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextMetadataOutcomeV1 {
    pub input: Box<ContextMetadataRequestV1>,
    pub decision: ContextMetadataDecisionV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ContextMetadataDecisionV1 {
    Projected { body_json: String },
    Rejected { reason: ContextMetadataRejectionV1 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum ContextMetadataRejectionV1 {
    #[error("context_metadata_base_invalid")]
    InvalidBase,
}

#[cfg(test)]
mod tests;
