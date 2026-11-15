//! Original manual evidence input values and finite validation observations.
use serde::{Deserialize, Serialize};
pub const CAPABILITY_ID: &str = "literature.evidence-write";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaimDraft {
    pub id: Option<String>,
    pub project_id: Option<String>,
    pub statement: String,
    #[serde(default = "assertion_role")]
    pub epistemic_role: String,
    pub expected_revision: Option<i64>,
    pub change_reason: Option<String>,
}

fn assertion_role() -> String {
    "assertion".to_owned()
}

pub use crate::evidence::Claim;

pub use crate::evidence::SourceAnchorSummary;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLinkDraft {
    pub claim_id: String,
    pub anchor_id: String,
    pub stance: String,
    #[serde(default)]
    pub rationale: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NewEvidenceDraft {
    pub anchor_id: String,
    pub stance: String,
    #[serde(default)]
    pub rationale: String,
}

pub use crate::evidence::EvidenceLink;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EvidenceWriteInputV1 {
    Claim {
        statement: String,
        epistemic_role: String,
    },
    Stance {
        stance: String,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceWriteDecisionV1 {
    pub rejection: Option<EvidenceWriteRejectionV1>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum EvidenceWriteRejectionV1 {
    EmptyStatement,
    InvalidEpistemicRole(String),
    InvalidStance(String),
}
impl EvidenceWriteRejectionV1 {
    pub fn message(&self) -> String {
        match self {
            Self::EmptyStatement => "观点内容不能为空".into(),
            Self::InvalidEpistemicRole(value) => format!("不支持的认识角色：{value}"),
            Self::InvalidStance(value) => format!("不支持的证据关系：{value}"),
        }
    }
}
impl EvidenceWriteInputV1 {
    pub fn matches_decision(&self, decision: &EvidenceWriteDecisionV1) -> bool {
        match (&self, &decision.rejection) {
            (_, None) => true,
            (Self::Claim { .. }, Some(EvidenceWriteRejectionV1::EmptyStatement)) => true,
            (
                Self::Claim { epistemic_role, .. },
                Some(EvidenceWriteRejectionV1::InvalidEpistemicRole(value)),
            ) => epistemic_role == value,
            (Self::Stance { stance }, Some(EvidenceWriteRejectionV1::InvalidStance(value))) => {
                stance == value
            }
            _ => false,
        }
    }
}
