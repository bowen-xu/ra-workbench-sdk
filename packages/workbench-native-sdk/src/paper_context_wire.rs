//! Finite pure context preparation; sources, SQL and transaction owners stay outside.
use serde::{Deserialize, Serialize};
mod codec;
pub use codec::{
    PaperContextCodecError, PaperContextCodecErrorKind, decode_payload, encode_payload,
};

pub const CAPABILITY_ID: &str = "literature.paper-context";
pub const CAPABILITY_VERSION: u32 = 1;

/// Opaque CBOR/base64 leaves preserve typed values before the original JSON
/// persistence boundary. The complete leaf is echoed to bind each pure result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperContextInputV1 {
    Build {
        cbor_base64: String,
    },
    Project {
        cbor_base64: String,
    },
    Digest {
        cbor_base64: String,
    },
    /// Requires the separately declared literature.paper-context-preview@1.
    Preview {
        cbor_base64: String,
    },
    /// Requires the separately declared literature.paper-context-prepare@1.
    Prepare {
        cbor_base64: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperContextOutcomeV1 {
    pub input: Box<PaperContextInputV1>,
    pub decision: PaperContextDecisionV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperContextDecisionV1 {
    Built { prepared_cbor_base64: String },
    Projected { projection_cbor_base64: String },
    Digested { context_hash: String },
    Previewed { decision_cbor_base64: String },
    Prepared { decision_cbor_base64: String },
    Rejected { message: String },
    Unavailable {},
}

#[cfg(test)]
mod tests;
