// Adapted from OpenAI Codex protocol/src/user_input.rs at
// e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Copyright 2025 OpenAI. See third-party/codex/LICENSE and NOTICE.
// Native adapters resolve opaque resource identities instead of renderer paths.
use crate::{skills::SkillIdentity, submission::SubmissionError};
use serde::{Deserialize, Serialize};
pub mod evidence;
use evidence::EvidenceImage;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum UserInput {
    Text {
        text: String,
        #[serde(default)]
        text_elements: Vec<TextElement>,
    },
    Skill {
        name: String,
        identity: SkillIdentity,
    },
    Mention {
        name: String,
        target: MentionTarget,
    },
    // Compatibility at the read boundary; serialization always uses annotation.
    #[serde(alias = "selection")]
    Annotation {
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_optional_source"
        )]
        source: Option<String>,
        title: String,
        text: String,
        #[serde(default)]
        comment: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        image: Option<EvidenceImage>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_text: Option<String>,
    },
}

fn deserialize_optional_source<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    String::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextElement {
    pub start_utf16: usize,
    pub end_utf16: usize,
    pub item_index: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MentionTarget {
    Tool {
        server_id: String,
        environment_id: String,
        revision: String,
    },
    File {
        source_id: String,
        resource_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_url: Option<String>,
        /// Read compatibility for old tags; never emitted or checked.
        #[serde(default, skip_serializing)]
        revision: String,
    },
}

/// Legacy records have no items. Structured input preserves both the displayed
/// text and precise selected identities; it never conveys resource permission.
pub fn validate(items: &[UserInput], text: &str) -> Result<(), SubmissionError> {
    if items.is_empty() {
        return Ok(());
    }
    if items.len() > 257 {
        return Err(SubmissionError::InvalidInput);
    }
    let Some(UserInput::Text {
        text: submitted,
        text_elements,
    }) = items.first()
    else {
        return Err(SubmissionError::InvalidInput);
    };
    if submitted != text || text_elements.len() > 256 {
        return Err(SubmissionError::InvalidInput);
    }
    let mut previous_end = 0;
    let utf16_len = text.encode_utf16().count();
    let mut boundaries = std::collections::HashSet::from([0]);
    let mut offset = 0;
    for character in text.chars() {
        offset += character.len_utf16();
        boundaries.insert(offset);
    }
    for element in text_elements {
        if element.start_utf16 < previous_end
            || element.end_utf16 <= element.start_utf16
            || element.end_utf16 > utf16_len
            || element.item_index == 0
            || element.item_index >= items.len()
            || !matches!(
                items.get(element.item_index),
                Some(UserInput::Skill { .. } | UserInput::Mention { .. })
            )
            || !boundaries.contains(&element.start_utf16)
            || !boundaries.contains(&element.end_utf16)
        {
            return Err(SubmissionError::InvalidInput);
        }
        previous_end = element.end_utf16;
    }
    for item in &items[1..] {
        let valid = match item {
            UserInput::Text { .. } => false,
            UserInput::Annotation {
                source,
                title,
                text,
                comment,
                image,
                display_text,
            } => {
                evidence::valid_target(source.as_deref(), title, text)
                    && (source.is_some() || (image.is_none() && display_text.is_none()))
                    && comment.len() <= 65536
                    && !comment.contains('\0')
                    && image.as_ref().is_none_or(EvidenceImage::valid)
                    && display_text
                        .as_ref()
                        .is_none_or(|text| text.len() <= 262_144 && !text.contains('\0'))
            }
            UserInput::Skill { name, identity } => safe(name) && identity.validate().is_ok(),
            UserInput::Mention { name, target } => {
                safe(name)
                    && match target {
                        MentionTarget::Tool {
                            server_id,
                            environment_id,
                            revision,
                        } => [server_id, environment_id, revision]
                            .iter()
                            .all(|v| safe(v)),
                        MentionTarget::File {
                            source_id,
                            resource_id,
                            source_url,
                            ..
                        } => {
                            [source_id, resource_id].iter().all(|v| safe(v))
                                && source_url.as_ref().is_none_or(|url| {
                                    crate::text_patch::address::parse(url).is_ok()
                                })
                        }
                    }
            }
        };
        if !valid {
            return Err(SubmissionError::InvalidInput);
        }
    }
    if serde_json::to_vec(items)
        .map_err(|_| SubmissionError::InvalidInput)?
        .len()
        > 2 * 1024 * 1024
    {
        return Err(SubmissionError::InvalidInput);
    }
    Ok(())
}

fn safe(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn files_have_stable_identity_without_content_revisions() {
        for legacy in [None, Some("old-content-hash")] {
            let mut target =
                serde_json::json!({"kind":"file","sourceId":"source","resourceId":"file"});
            if let Some(revision) = legacy {
                target["revision"] = revision.into();
            }
            let input: Vec<UserInput> = serde_json::from_value(serde_json::json!([
                {"type":"text","text":"@file","textElements":[{"startUtf16":0,"endUtf16":5,"itemIndex":1}]},
                {"type":"mention","name":"file","target":target}
            ])).unwrap();
            validate(&input, "@file").unwrap();
            assert!(
                serde_json::to_value(&input).unwrap()[1]["target"]
                    .get("revision")
                    .is_none()
            );
        }
    }
    #[test]
    fn structured_skill_identity_survives_roundtrip() {
        let input = vec![
            UserInput::Text {
                text: "@review".into(),
                text_elements: vec![TextElement {
                    start_utf16: 0,
                    end_utf16: 7,
                    item_index: 1,
                }],
            },
            UserInput::Skill {
                name: "review".into(),
                identity: SkillIdentity {
                    environment_id: "application".into(),
                    source_id: ".agents/skills/review/SKILL.md".into(),
                    revision: "version".into(),
                },
            },
        ];
        validate(&input, "@review").unwrap();
        assert_eq!(
            input,
            serde_json::from_slice::<Vec<UserInput>>(&serde_json::to_vec(&input).unwrap()).unwrap()
        );
        assert!(validate(&input, "edited").is_err());
    }
    #[test]
    fn legacy_and_invalid_binding() {
        validate(&[], "old text").unwrap();
        assert!(
            validate(
                &[UserInput::Text {
                    text: "x".into(),
                    text_elements: vec![TextElement {
                        start_utf16: 0,
                        end_utf16: 1,
                        item_index: 1
                    }]
                }],
                "x"
            )
            .is_err()
        );
    }
}
