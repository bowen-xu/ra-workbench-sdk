//! Deterministic, loss-aware history compaction.
//!
//! Adapted from Codex context-manager compaction boundaries. The application
//! keeps the durable conversation untouched; this module only builds a bounded
//! request projection and records what was omitted. A provider may later turn
//! `summary_input` into a model-generated summary, but that summary is never
//! silently mixed into the durable history.

use crate::model::{ContentPart, ModelMessage};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactionRecord {
    pub original_message_count: usize,
    pub retained_message_count: usize,
    pub omitted_message_count: usize,
    pub original_bytes: usize,
    pub retained_bytes: usize,
    pub history_sha256: String,
    /// Text supplied to a summarizer, bounded independently from the request.
    pub summary_input: String,
}

#[derive(Clone)]
pub struct CompactedHistory {
    pub messages: Vec<ModelMessage>,
    pub record: CompactionRecord,
}

/// Host-selected automatic compaction policy. The trigger is deliberately
/// separate from the request budget so callers can leave headroom for the
/// current prompt and tool schemas.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompactionPolicy {
    pub trigger_bytes: usize,
    pub request_max_bytes: usize,
    pub summary_max_bytes: usize,
}

impl CompactionPolicy {
    pub fn validate(self) -> Result<(), CompactionError> {
        if self.trigger_bytes == 0
            || self.request_max_bytes == 0
            || self.summary_max_bytes == 0
            || self.trigger_bytes < self.request_max_bytes
        {
            return Err(CompactionError::InvalidBudget);
        }
        Ok(())
    }
}

/// Returns a compacted request projection only when the history crosses the
/// configured trigger. The durable journal is never changed by this helper.
pub fn compact_if_needed(
    history: &[ModelMessage],
    policy: CompactionPolicy,
) -> Result<Option<CompactedHistory>, CompactionError> {
    policy.validate()?;
    let bytes = history.iter().map(message_bytes).sum::<usize>();
    if bytes < policy.trigger_bytes {
        return Ok(None);
    }
    compact_history(history, policy.request_max_bytes, policy.summary_max_bytes).map(Some)
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CompactionError {
    #[error("compaction budget is invalid")]
    InvalidBudget,
    #[error("history cannot be compacted without retaining a user message")]
    NoUserMessage,
}

/// Keep the newest structurally safe suffix. System messages at the beginning
/// are always retained, and a suffix never starts with a tool result or splits
/// an assistant tool-call group. The caller can persist `record` alongside the
/// request while the original history remains authoritative.
pub fn compact_history(
    history: &[ModelMessage],
    max_bytes: usize,
    summary_max_bytes: usize,
) -> Result<CompactedHistory, CompactionError> {
    if max_bytes == 0 || summary_max_bytes == 0 {
        return Err(CompactionError::InvalidBudget);
    }
    let sizes: Vec<usize> = history.iter().map(message_bytes).collect();
    let original_bytes = sizes.iter().sum();
    let history_sha256 = hash_history(history);
    if original_bytes <= max_bytes {
        return Ok(CompactedHistory {
            messages: history.to_vec(),
            record: CompactionRecord {
                original_message_count: history.len(),
                retained_message_count: history.len(),
                omitted_message_count: 0,
                original_bytes,
                retained_bytes: original_bytes,
                history_sha256,
                summary_input: String::new(),
            },
        });
    }

    let system_end = history
        .iter()
        .position(|message| {
            !matches!(
                message,
                ModelMessage::System(_) | ModelMessage::Developer(_)
            )
        })
        .unwrap_or(history.len());
    let mut cursor = history.len();
    let mut start = None;
    while cursor > system_end {
        let candidate = cursor - 1;
        cursor = candidate;
        if !matches!(history[candidate], ModelMessage::User { .. }) {
            continue;
        }
        let candidate_bytes =
            sizes[candidate..].iter().sum::<usize>() + sizes[..system_end].iter().sum::<usize>();
        if candidate_bytes > max_bytes {
            break;
        }
        start = Some(candidate);
    }
    let start = start.ok_or(CompactionError::NoUserMessage)?;
    let retained = system_end + history[start..].len();
    let mut messages = history[..system_end].to_vec();
    messages.extend_from_slice(&history[start..]);
    if !messages
        .iter()
        .any(|message| matches!(message, ModelMessage::User { .. }))
    {
        return Err(CompactionError::NoUserMessage);
    }
    let retained_bytes = messages.iter().map(message_bytes).sum();
    let summary_input = bounded_text(&history[system_end..start], summary_max_bytes);
    Ok(CompactedHistory {
        messages,
        record: CompactionRecord {
            original_message_count: history.len(),
            retained_message_count: retained,
            omitted_message_count: start.saturating_sub(system_end),
            original_bytes,
            retained_bytes,
            history_sha256,
            summary_input,
        },
    })
}

fn message_bytes(message: &ModelMessage) -> usize {
    match message {
        ModelMessage::System(text) | ModelMessage::Developer(text) => text.len(),
        ModelMessage::CanonicalOutput(item) => {
            serde_json::to_vec(item).map_or(usize::MAX, |bytes| bytes.len())
        }
        ModelMessage::User { content: parts, .. }
        | ModelMessage::Assistant { content: parts, .. } => {
            let content = parts
                .iter()
                .map(|part| match part {
                    ContentPart::Text(text) => text.len(),
                    ContentPart::Image { bytes, .. } => bytes.len(),
                })
                .sum();
            if let ModelMessage::Assistant { tool_calls, .. } = message {
                tool_calls.iter().fold(content, |sum, call| {
                    sum.saturating_add(
                        call.raw_arguments_json
                            .as_ref()
                            .map_or_else(|| call.arguments.to_string().len(), String::len),
                    )
                    .saturating_add(call.namespace.as_ref().map_or(0, String::len))
                })
            } else {
                content
            }
        }
        ModelMessage::ToolResult { content, .. } => content.len(),
    }
}

fn bounded_text(messages: &[ModelMessage], max_bytes: usize) -> String {
    let mut result = String::new();
    for message in messages {
        let (role, texts): (&str, Vec<&str>) = match message {
            ModelMessage::System(text) => ("system", vec![text]),
            ModelMessage::Developer(text) => ("developer", vec![text]),
            ModelMessage::CanonicalOutput(item) => match &item.normalized {
                Some(crate::model::ModelOutputItem::Message(message)) => {
                    ("assistant", vec![message.text.as_str()])
                }
                Some(crate::model::ModelOutputItem::ToolCall(_)) => ("assistant", vec![]),
                Some(crate::model::ModelOutputItem::ReasoningSummary(summary)) => {
                    ("reasoning-summary", vec![summary.text.as_str()])
                }
                None => ("provider-native", vec![]),
            },
            ModelMessage::User { content: parts, .. }
            | ModelMessage::Assistant { content: parts, .. } => {
                let role = if matches!(message, ModelMessage::User { .. }) {
                    "user"
                } else {
                    "assistant"
                };
                (
                    role,
                    parts
                        .iter()
                        .filter_map(|part| match part {
                            ContentPart::Text(text) => Some(text.as_str()),
                            ContentPart::Image { .. } => None,
                        })
                        .collect(),
                )
            }
            ModelMessage::ToolResult { content, .. } => ("tool", vec![content]),
        };
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(role);
        result.push_str(": ");
        result.push_str(&texts.join("\n"));
        if result.len() >= max_bytes {
            break;
        }
    }
    truncate_text_to_bytes(&result, max_bytes)
}

/// Bound UTF-8 text by encoded bytes without splitting a scalar value.
/// Compaction hosts use the same primitive when fitting a generated or
/// deterministic summary into the remaining request budget.
pub fn truncate_text_to_bytes(text: &str, max_bytes: usize) -> String {
    let end = text.len().min(max_bytes);
    text[..text.floor_char_boundary(end)].to_owned()
}

fn hash_history(history: &[ModelMessage]) -> String {
    let mut hasher = Sha256::new();
    for message in history {
        match message {
            ModelMessage::System(text) => {
                hasher.update(b"system\0");
                hash_bytes(&mut hasher, text.as_bytes());
            }
            ModelMessage::Developer(text) => {
                hasher.update(b"developer\0");
                hash_bytes(&mut hasher, text.as_bytes());
            }
            ModelMessage::CanonicalOutput(item) => {
                hasher.update(b"canonical\0");
                // Validated complete data, including opaque material, affects
                // cache identity but never enters the textual summary prompt.
                hash_bytes(
                    &mut hasher,
                    &serde_json::to_vec(item).expect("JSON values serialize"),
                );
            }
            ModelMessage::User { content: parts, .. } => {
                hasher.update(b"user\0");
                hash_parts(&mut hasher, parts);
            }
            ModelMessage::Assistant {
                content,
                tool_calls,
                phase,
            } => {
                hasher.update(b"assistant\0");
                if let Some(phase) = phase {
                    hasher.update(b"phase\0");
                    hash_bytes(&mut hasher, format!("{phase:?}").as_bytes());
                }
                hash_parts(&mut hasher, content);
                for call in tool_calls {
                    hash_bytes(&mut hasher, call.call_id.as_bytes());
                    hash_bytes(&mut hasher, call.name.as_bytes());
                    if let Some(namespace) = &call.namespace {
                        hasher.update(b"namespace\0");
                        hash_bytes(&mut hasher, namespace.as_bytes());
                    }
                    hash_bytes(&mut hasher, call.arguments.to_string().as_bytes());
                    if let Some(raw) = &call.raw_arguments_json {
                        hasher.update(b"raw_arguments\0");
                        hash_bytes(&mut hasher, raw.as_bytes());
                    }
                }
            }
            ModelMessage::ToolResult {
                call_id,
                content,
                is_error,
            } => {
                hasher.update(b"tool\0");
                hash_bytes(&mut hasher, call_id.as_bytes());
                hash_bytes(&mut hasher, content.as_bytes());
                hasher.update([u8::from(*is_error)]);
            }
        }
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn hash_parts(hasher: &mut Sha256, parts: &[ContentPart]) {
    for part in parts {
        match part {
            ContentPart::Text(text) => {
                hasher.update(b"text\0");
                hash_bytes(hasher, text.as_bytes());
            }
            ContentPart::Image { media_type, bytes } => {
                hasher.update(b"image\0");
                hash_bytes(hasher, media_type.as_bytes());
                hash_bytes(hasher, bytes);
            }
        }
    }
}

fn hash_bytes(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update(bytes.len().to_le_bytes());
    hasher.update(bytes);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn text(value: &str) -> Vec<ContentPart> {
        vec![ContentPart::Text(value.into())]
    }

    #[test]
    fn preserves_developer_prefix_and_hashes_its_role_independently() {
        let history = vec![
            ModelMessage::System("rules".into()),
            ModelMessage::Developer("guidance".into()),
            ModelMessage::User {
                content: text(&"old".repeat(100)),
                source_item_id: None,
            },
            ModelMessage::User {
                content: text("latest"),
                source_item_id: None,
            },
        ];
        let compacted = compact_history(&history, 40, 1024).unwrap();
        assert!(compacted.messages[..2] == history[..2]);
        assert_eq!(compacted.messages.len(), 3);
        assert_ne!(
            hash_history(&[ModelMessage::Developer("same".into())]),
            hash_history(&[ModelMessage::System("same".into())])
        );
    }

    #[test]
    fn preserves_system_and_newest_complete_user_led_suffix() {
        let history = vec![
            ModelMessage::System("rules".into()),
            ModelMessage::User {
                content: text("old question"),
                source_item_id: None,
            },
            ModelMessage::Assistant {
                phase: None,
                content: text("old answer"),
                tool_calls: vec![],
            },
            ModelMessage::User {
                content: text("new question"),
                source_item_id: None,
            },
            ModelMessage::Assistant {
                phase: None,
                content: text("new answer"),
                tool_calls: vec![],
            },
        ];
        let compacted = compact_history(&history, 30, 1024).unwrap();
        assert_eq!(compacted.messages.len(), 3);
        assert!(matches!(compacted.messages[0], ModelMessage::System(_)));
        assert!(matches!(compacted.messages[1], ModelMessage::User { .. }));
        assert_eq!(compacted.record.omitted_message_count, 2);
        assert!(compacted.record.summary_input.contains("old question"));
        assert!(compacted.record.summary_input.contains("old answer"));
    }

    #[test]
    fn never_starts_retained_history_with_a_tool_result() {
        let history = vec![
            ModelMessage::User {
                content: text("old"),
                source_item_id: None,
            },
            ModelMessage::Assistant {
                phase: None,
                content: vec![],
                tool_calls: vec![crate::model::ToolCall {
                    namespace: None,
                    raw_arguments_json: None,
                    call_id: "c1".into(),
                    name: "read".into(),
                    arguments: json!({"path":"a"}),
                }],
            },
            ModelMessage::ToolResult {
                call_id: "c1".into(),
                content: "result".into(),
                is_error: false,
            },
            ModelMessage::User {
                content: text("latest"),
                source_item_id: None,
            },
            ModelMessage::Assistant {
                phase: None,
                content: text("answer"),
                tool_calls: vec![],
            },
        ];
        let compacted = compact_history(&history, 20, 1024).unwrap();
        assert!(matches!(compacted.messages[0], ModelMessage::User { .. }));
        assert!(matches!(
            compacted.messages[1],
            ModelMessage::Assistant { .. }
        ));
    }

    #[test]
    fn records_content_sensitive_hash_without_mutating_original() {
        let first = vec![ModelMessage::User {
            content: text("abc"),
            source_item_id: None,
        }];
        let second = vec![ModelMessage::User {
            content: text("xyz"),
            source_item_id: None,
        }];
        let a = compact_history(&first, 100, 100).unwrap();
        let b = compact_history(&second, 100, 100).unwrap();
        assert_ne!(a.record.history_sha256, b.record.history_sha256);
        assert_eq!(a.record.omitted_message_count, 0);
        assert!(a.record.summary_input.is_empty());
    }

    #[test]
    fn truncates_summary_on_utf8_boundary() {
        let history = vec![
            ModelMessage::User {
                content: text("旧问题一二三"),
                source_item_id: None,
            },
            ModelMessage::Assistant {
                phase: None,
                content: text("旧回答"),
                tool_calls: vec![],
            },
            ModelMessage::User {
                content: text("new"),
                source_item_id: None,
            },
        ];
        let compacted = compact_history(&history, 3, 8).unwrap();
        assert!(
            compacted
                .record
                .summary_input
                .is_char_boundary(compacted.record.summary_input.len())
        );
        assert!(compacted.record.summary_input.len() <= 8);
        assert_eq!(truncate_text_to_bytes("一二三", 7), "一二");
    }

    #[test]
    fn automatic_policy_only_projects_after_trigger() {
        let history = vec![ModelMessage::User {
            content: text("hello"),
            source_item_id: None,
        }];
        let policy = CompactionPolicy {
            trigger_bytes: 5,
            request_max_bytes: 5,
            summary_max_bytes: 32,
        };
        assert!(compact_if_needed(&history, policy).unwrap().is_some());
        let quiet = CompactionPolicy {
            trigger_bytes: 99,
            ..policy
        };
        assert!(compact_if_needed(&history, quiet).unwrap().is_none());
    }
}
