//! Original manual reading-unit fields and finite List/Save preparation.
use serde::{Deserialize, Serialize};
pub mod accepted;
pub const CAPABILITY_ID: &str = "literature.reading-units";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredReadingUnitDraft {
    pub id: Option<String>,
    pub project_id: Option<String>,
    pub paper_id: Option<String>,
    pub unit_kind: String,
    pub title: String,
    pub body: String,
    pub epistemic_role: String,
    pub anchor_id: Option<String>,
    pub evidence_stance: Option<String>,
    pub evidence_rationale: Option<String>,
    pub expected_revision: Option<i64>,
    pub change_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredReadingUnit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_field: Option<ReadingUnitTemplateField>,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_title: Option<String>,
    pub unit_kind: String,
    pub title: String,
    pub body: String,
    pub provenance_kind: String,
    pub epistemic_role: String,
    pub revision: i64,
    pub evidence_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingUnitTemplateField {
    pub portrait_candidate_id: String,
    pub field_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadingUnitRequestV1 {
    List {
        project_id: Option<String>,
        paper_id: Option<String>,
    },
    Save {
        draft: Box<StructuredReadingUnitDraft>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadingUnitRejectionV1 {
    EmptyBody,
    TitleTooLong,
    UnitKind,
    EpistemicRole,
    EvidenceStance,
    NewExpectedRevision,
}
impl<'de> Deserialize<'de> for ReadingUnitRejectionV1 {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match String::deserialize(d)?.as_str() {
            "emptyBody" => Ok(Self::EmptyBody),
            "titleTooLong" => Ok(Self::TitleTooLong),
            "unitKind" => Ok(Self::UnitKind),
            "epistemicRole" => Ok(Self::EpistemicRole),
            "evidenceStance" => Ok(Self::EvidenceStance),
            "newExpectedRevision" => Ok(Self::NewExpectedRevision),
            _ => Err(serde::de::Error::custom("unknown reading-unit rejection")),
        }
    }
}
impl ReadingUnitRejectionV1 {
    pub fn message(self) -> &'static str {
        match self {
            Self::EmptyBody => "阅读单元内容不能为空",
            Self::TitleTooLong => "阅读单元标题不能超过 240 个字符",
            Self::UnitKind => "不支持的阅读单元类型",
            Self::EpistemicRole => "不支持的认识角色",
            Self::EvidenceStance => "不支持的证据关系",
            Self::NewExpectedRevision => "新建阅读单元不能指定 expectedRevision",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingUnitRulesV1 {
    pub provenance_kind: String,
    pub object_kind: String,
    pub editor_kind: String,
    pub change_reason: String,
    pub initial_revision: i64,
    /// Applied only after the original Deferred BEGIN, never during preparation.
    pub new_expected_rejection: Option<ReadingUnitRejectionV1>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadingUnitPlanV1 {
    List {
        project_id: Option<String>,
        paper_id: Option<String>,
    },
    Save {
        draft: Box<StructuredReadingUnitDraft>,
        title: String,
        body: String,
        evidence_stance: String,
        evidence_rationale: String,
        rules: Box<ReadingUnitRulesV1>,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadingUnitPreparationV1 {
    Ready {
        plan: Box<ReadingUnitPlanV1>,
    },
    Rejected {
        input: Box<ReadingUnitRequestV1>,
        reason: ReadingUnitRejectionV1,
    },
}

#[cfg(test)]
mod tests;
