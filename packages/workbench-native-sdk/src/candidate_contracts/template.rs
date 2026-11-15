//! Original strict template identity and immutable snapshot DTOs.
use super::TemplateField;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged, deny_unknown_fields)]
pub enum PaperTemplateRef {
    Legacy {
        #[serde(rename = "portraitCandidateId")]
        portrait_candidate_id: String,
        #[serde(rename = "portraitRevision")]
        portrait_revision: i64,
    },
    Resource {
        #[serde(rename = "templateResourceId")]
        template_resource_id: String,
        #[serde(rename = "templateResourceRevision")]
        template_resource_revision: i64,
    },
}
impl PaperTemplateRef {
    pub fn id(&self) -> &str {
        match self {
            Self::Legacy {
                portrait_candidate_id,
                ..
            } => portrait_candidate_id,
            Self::Resource {
                template_resource_id,
                ..
            } => template_resource_id,
        }
    }
    pub fn revision(&self) -> i64 {
        match self {
            Self::Legacy {
                portrait_revision, ..
            } => *portrait_revision,
            Self::Resource {
                template_resource_revision,
                ..
            } => *template_resource_revision,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaperTemplateSnapshot {
    #[serde(flatten)]
    pub reference: PaperTemplateRef,
    pub fields: Vec<TemplateField>,
}

impl<'de> Deserialize<'de> for PaperTemplateSnapshot {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // serde flatten + deny_unknown_fields cannot distinguish the two
        // untagged identities. Decode the strict wire shape explicitly instead.
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire {
            portrait_candidate_id: Option<String>,
            portrait_revision: Option<i64>,
            template_resource_id: Option<String>,
            template_resource_revision: Option<i64>,
            fields: Vec<TemplateField>,
        }
        let wire = Wire::deserialize(deserializer)?;
        let reference = match (
            wire.portrait_candidate_id,
            wire.portrait_revision,
            wire.template_resource_id,
            wire.template_resource_revision,
        ) {
            (Some(portrait_candidate_id), Some(portrait_revision), None, None) => {
                PaperTemplateRef::Legacy {
                    portrait_candidate_id,
                    portrait_revision,
                }
            }
            (None, None, Some(template_resource_id), Some(template_resource_revision)) => {
                PaperTemplateRef::Resource {
                    template_resource_id,
                    template_resource_revision,
                }
            }
            _ => {
                return Err(serde::de::Error::custom(
                    "template snapshot requires exactly one complete identity",
                ));
            }
        };
        Ok(Self {
            reference,
            fields: wire.fields,
        })
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiReadingProfileRef {
    pub profile_id: String,
    pub profile_version: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiOverviewProfileContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_template: Option<PaperTemplateSnapshot>,
    pub paper_id: String,
    pub selection_revision: i64,
    pub profile_refs: Vec<AiReadingProfileRef>,
    pub field_kinds: Vec<String>,
}
