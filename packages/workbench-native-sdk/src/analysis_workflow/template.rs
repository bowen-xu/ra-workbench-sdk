//! Observations at the original lazy template-resolution boundaries.
use super::AnalysisWorkflowError;
use crate::candidate_contracts::{AiOverviewProfileContext, PaperTemplateRef};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TemplateInputV1 {
    LegacyAvailability {
        managed_resources: bool,
    },
    LegacyIdentity {
        reference: PaperTemplateRef,
        latest: Option<(String, i64)>,
    },
    LegacyContent {
        paper_id: String,
        reference: PaperTemplateRef,
        current_revision: i64,
        evidence: Vec<TemplateEvidenceV1>,
        revisions: Vec<TemplateRevisionV1>,
    },
    ResourceBinding {
        reference: PaperTemplateRef,
        selection_revision: i64,
        binding: Option<(String, i64)>,
    },
    ResourceContent {
        paper_id: String,
        reference: PaperTemplateRef,
        selection_revision: i64,
        raw: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateEvidenceV1 {
    pub paper_id: String,
    pub current_anchor_status: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateRevisionV1 {
    pub revision: i64,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TemplateDecisionV1 {
    Verified {},
    Resolved { profile: AiOverviewProfileContext },
    Rejected { error: AnalysisWorkflowError },
}

impl TemplateInputV1 {
    pub fn matches_decision(&self, decision: &TemplateDecisionV1) -> bool {
        match (self, decision) {
            (_, TemplateDecisionV1::Rejected { .. }) => true,
            (
                Self::LegacyAvailability { .. }
                | Self::LegacyIdentity { .. }
                | Self::ResourceBinding { .. },
                TemplateDecisionV1::Verified {},
            ) => true,
            (
                Self::LegacyContent {
                    paper_id,
                    reference,
                    ..
                },
                TemplateDecisionV1::Resolved { profile },
            ) => {
                profile.paper_id == *paper_id
                    && profile.selection_revision == reference.revision()
                    && profile
                        .paper_template
                        .as_ref()
                        .is_some_and(|template| template.reference == *reference)
            }
            (
                Self::ResourceContent {
                    paper_id,
                    reference,
                    selection_revision,
                    ..
                },
                TemplateDecisionV1::Resolved { profile },
            ) => {
                profile.paper_id == *paper_id
                    && profile.selection_revision == *selection_revision
                    && profile
                        .paper_template
                        .as_ref()
                        .is_some_and(|template| template.reference == *reference)
            }
            _ => false,
        }
    }
}
