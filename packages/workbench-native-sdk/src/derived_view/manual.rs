//! Finite manual validation and the original provenance transition.
use super::*;
pub const CAPABILITY_ID: &str = "literature.derived-views";
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DerivedViewInputV1 {
    Validate {
        input: Box<DerivedValidationInputV1>,
    },
    Provenance {
        current: String,
        review: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DerivedViewDecisionV1 {
    Validated {
        rejection: Option<DerivedRejectionV1>,
    },
    Provenance {
        value: String,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DerivedRejectionV1 {
    Header,
    Input,
    Coverage,
    Item,
    Provenance,
}
impl DerivedRejectionV1 {
    pub fn message(self) -> &'static str {
        match self {
            Self::Header => "派生研究视图参数无效",
            Self::Input => "派生视图输入无效",
            Self::Coverage => "派生视图输入必须是有来源的已填充单元",
            Self::Item => "派生视图条目必须由所选输入证据支持",
            Self::Provenance => "AI 派生视图审查来源无效",
        }
    }
    pub fn for_input(input: &DerivedValidationInputV1) -> Self {
        match input {
            DerivedValidationInputV1::Header { .. } => Self::Header,
            DerivedValidationInputV1::Input { .. } => Self::Input,
            DerivedValidationInputV1::Coverage { .. } => Self::Coverage,
            DerivedValidationInputV1::Item { .. } => Self::Item,
            DerivedValidationInputV1::Provenance { .. } => Self::Provenance,
        }
    }
}
impl DerivedViewInputV1 {
    pub fn matches_decision(&self, decision: &DerivedViewDecisionV1) -> bool {
        match (self, decision) {
            (Self::Validate { input }, DerivedViewDecisionV1::Validated { rejection }) => {
                rejection.is_none_or(|reason| reason == DerivedRejectionV1::for_input(input))
            }
            (Self::Provenance { current, review }, DerivedViewDecisionV1::Provenance { value }) => {
                value == current
                    || (current == "ai_suggestion"
                        && review == "accepted"
                        && value == "ai_accepted_after_edit")
            }
            _ => false,
        }
    }
}
