//! Original concept input codecs and finite search/save preparation contracts.
pub use crate::knowledge_snapshot::{KnowledgeConcept as Concept, KnowledgeTerm as Term};
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.concepts";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptDraft {
    pub id: Option<String>,
    pub preferred_term: String,
    pub language: Option<String>,
    pub label: String,
    pub explanation: String,
    pub disambiguation: String,
    pub domain: String,
    pub tradition: String,
    pub period: String,
    pub expected_revision: Option<i64>,
    pub change_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConceptDetails {
    pub label: String,
    pub explanation: String,
    pub disambiguation: String,
    pub domain: String,
    pub tradition: String,
    pub period: String,
    pub change_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConceptRequestV1 {
    Search { query: String },
    Save { draft: Box<ConceptDraft> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConceptRejectionV1 {
    InvalidNameLength,
    EmptyNameContext,
    FieldsTooLong,
    EmptyTerm,
    TermTooLong,
    NameUnavailable,
    MergedIdentity,
    NewExpectedRevision,
    MissingPreferredTerm,
}
impl<'de> Deserialize<'de> for ConceptRejectionV1 {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match String::deserialize(d)?.as_str() {
            "invalidNameLength" => Ok(Self::InvalidNameLength),
            "emptyNameContext" => Ok(Self::EmptyNameContext),
            "fieldsTooLong" => Ok(Self::FieldsTooLong),
            "emptyTerm" => Ok(Self::EmptyTerm),
            "termTooLong" => Ok(Self::TermTooLong),
            "nameUnavailable" => Ok(Self::NameUnavailable),
            "mergedIdentity" => Ok(Self::MergedIdentity),
            "newExpectedRevision" => Ok(Self::NewExpectedRevision),
            "missingPreferredTerm" => Ok(Self::MissingPreferredTerm),
            _ => Err(serde::de::Error::custom("unknown concept rejection")),
        }
    }
}
impl ConceptRejectionV1 {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidNameLength => "概念名称须为 1–500 个字符",
            Self::EmptyNameContext => "分隔符前的名称和分隔符后的语境均不能为空",
            Self::FieldsTooLong => "概念字段超过允许长度",
            Self::EmptyTerm => "语词不能为空",
            Self::TermTooLong => "语词或语言标记过长",
            Self::NameUnavailable => "概念名称已存在，请使用不同名称，或用 ` 添加语境",
            Self::MergedIdentity => "旧概念 ID 已合并；请编辑当前保留节点或先拆回",
            Self::NewExpectedRevision => "新建概念不能指定 expectedRevision",
            Self::MissingPreferredTerm => "概念缺少首选语词",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptTermPlanV1 {
    pub text: String,
    pub normalized_text: String,
    pub language: String,
    /// Consumed only after the original BEGIN and name SQL, never during prepare.
    pub rejection: Option<ConceptRejectionV1>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptRulesV1 {
    pub provenance_kind: String,
    pub editor_kind: String,
    pub initial_revision: i64,
    pub term_object_kind: String,
    pub concept_object_kind: String,
    pub term_reason: String,
    pub concept_reason: String,
    /// The original new-ID refusal occurs after term lookup/creation.
    pub new_expected_rejection: Option<ConceptRejectionV1>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConceptPlanV1 {
    Search {
        query: String,
        normalized: String,
        pattern: String,
    },
    Save {
        draft: Box<ConceptDraft>,
        details: Box<NewConceptDetails>,
        term: ConceptTermPlanV1,
        rules: ConceptRulesV1,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConceptPreparationV1 {
    Ready {
        plan: Box<ConceptPlanV1>,
    },
    Rejected {
        input: Box<ConceptRequestV1>,
        reason: ConceptRejectionV1,
    },
}

#[cfg(test)]
mod tests;
