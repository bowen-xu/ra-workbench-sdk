//! Original frozen task text and Core-observed source classifications.
use crate::candidate_contracts::AiOverviewProfileContext;
use research_agent_api::{
    submission::ContextText,
    user_input::{MentionTarget, UserInput},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptResourceV1 {
    Paper {
        resource_id: String,
        attachment_id: Option<String>,
    },
    TemplateCatalog,
    Other,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptSourceV1 {
    pub source: ContextText,
    pub resource: PromptResourceV1,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskPromptInputV1 {
    pub task_template: String,
    pub reading_contract: String,
    pub sources: Vec<PromptSourceV1>,
    pub kind: String,
    pub profile: Option<AiOverviewProfileContext>,
    pub preferences: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PaperTaskPrompt {
    pub text: String,
    pub user_input: Vec<UserInput>,
}

// Keep legacy file revisions until the original JSON persistence boundary.
// UserInput's JSON serializer intentionally omits them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptRef<'a> {
    text: &'a str,
    user_input: &'a [UserInput],
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PromptFields {
    text: String,
    user_input: Vec<UserInput>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BinaryPromptRef<'a> {
    text: &'a str,
    user_input: &'a [UserInput],
    file_revisions: Vec<Option<&'a str>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BinaryPrompt {
    text: String,
    user_input: Vec<UserInput>,
    file_revisions: Vec<Option<String>>,
}
impl Serialize for PaperTaskPrompt {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if serializer.is_human_readable() {
            return PromptRef {
                text: &self.text,
                user_input: &self.user_input,
            }
            .serialize(serializer);
        }
        BinaryPromptRef {
            text: &self.text,
            user_input: &self.user_input,
            file_revisions: self
                .user_input
                .iter()
                .map(|item| match item {
                    UserInput::Mention {
                        target: MentionTarget::File { revision, .. },
                        ..
                    } => Some(revision.as_str()),
                    _ => None,
                })
                .collect(),
        }
        .serialize(serializer)
    }
}
impl<'de> Deserialize<'de> for PaperTaskPrompt {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if deserializer.is_human_readable() {
            let fields = PromptFields::deserialize(deserializer)?;
            return Ok(Self {
                text: fields.text,
                user_input: fields.user_input,
            });
        }
        let mut fields = BinaryPrompt::deserialize(deserializer)?;
        if fields.file_revisions.len() != fields.user_input.len() {
            return Err(serde::de::Error::custom(
                "task prompt file revision count mismatch",
            ));
        }
        for (item, saved) in fields.user_input.iter_mut().zip(fields.file_revisions) {
            match (item, saved) {
                (
                    UserInput::Mention {
                        target: MentionTarget::File { revision, .. },
                        ..
                    },
                    Some(value),
                ) => *revision = value,
                (
                    UserInput::Mention {
                        target: MentionTarget::File { .. },
                        ..
                    },
                    None,
                )
                | (_, Some(_)) => {
                    return Err(serde::de::Error::custom(
                        "task prompt file revision shape mismatch",
                    ));
                }
                (_, None) => {}
            }
        }
        Ok(Self {
            text: fields.text,
            user_input: fields.user_input,
        })
    }
}
