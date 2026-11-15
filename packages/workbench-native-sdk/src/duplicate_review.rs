//! Original duplicate-review shapes and lossless wire codecs; no review policy.
use crate::data::DataValue;
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.duplicate-review";
pub const CAPABILITY_VERSION: u32 = 1;

/// Private-wire IEEE754 bits. The public confidence remains the original f64.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct F64BitsV1(String);

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("invalid f64 wire bits")]
pub struct InvalidF64Bits;

impl F64BitsV1 {
    pub fn from_f64(value: f64) -> Self {
        Self(format!("{:016x}", value.to_bits()))
    }

    pub fn parse(value: String) -> Result<Self, InvalidF64Bits> {
        if value.len() != 16
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(InvalidF64Bits);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn to_f64(&self) -> f64 {
        // All constructors validate the private, immutable 16-digit encoding.
        let bits = u64::from_str_radix(&self.0, 16).expect("F64BitsV1 invariant");
        f64::from_bits(bits)
    }
}

impl Serialize for F64BitsV1 {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for F64BitsV1 {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// Original public IPC layout. Never used to send decimal confidence to a host.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidate {
    pub id: String,
    pub left_item_id: String,
    pub left_title: String,
    pub right_item_id: String,
    pub right_title: String,
    pub reason: String,
    pub confidence: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DuplicateCandidateBitsV1 {
    pub id: String,
    pub left_item_id: String,
    pub left_title: String,
    pub right_item_id: String,
    pub right_title: String,
    pub reason: String,
    pub confidence_bits: F64BitsV1,
}

impl DuplicateCandidateBitsV1 {
    /// Mechanical original-order tuple encoding for Core's full-row check.
    pub fn to_row(&self) -> Vec<DataValue> {
        [
            self.id.as_str(),
            self.left_item_id.as_str(),
            self.left_title.as_str(),
            self.right_item_id.as_str(),
            self.right_title.as_str(),
            self.reason.as_str(),
            self.confidence_bits.as_str(),
        ]
        .map(|value| DataValue::Text(value.into()))
        .into()
    }

    pub fn into_public(self) -> DuplicateCandidate {
        DuplicateCandidate {
            id: self.id,
            left_item_id: self.left_item_id,
            left_title: self.left_title,
            right_item_id: self.right_item_id,
            right_title: self.right_title,
            reason: self.reason,
            confidence: self.confidence_bits.to_f64(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergeOperation {
    pub id: String,
    pub survivor_item_id: String,
    pub survivor_title: String,
    pub merged_item_id: String,
    pub merged_title: String,
    pub state: String,
    pub created_at: String,
}

impl MergeOperation {
    pub fn to_row(&self) -> Vec<DataValue> {
        [
            &self.id,
            &self.survivor_item_id,
            &self.survivor_title,
            &self.merged_item_id,
            &self.merged_title,
            &self.state,
            &self.created_at,
        ]
        .map(|value| DataValue::Text(value.clone()))
        .into()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DuplicateDecisionRequestV1 {
    pub candidate_id: String,
    pub decision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinishDuplicateDecisionInputV1 {
    pub request: DuplicateDecisionRequestV1,
    pub affected_rows: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateRejectionCodeV1 {
    InvalidInput,
    NotFound,
}

impl DuplicateRejectionCodeV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid_input",
            Self::NotFound => "not_found",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DuplicateRejectionV1 {
    pub code: DuplicateRejectionCodeV1,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DuplicateDecisionPreparationV1 {
    Ready { request: DuplicateDecisionRequestV1 },
    Rejected { error: DuplicateRejectionV1 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DuplicateDecisionCompletionV1 {
    Applied {},
    Rejected { error: DuplicateRejectionV1 },
}

#[cfg(test)]
mod tests;
