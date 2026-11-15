use super::*;

pub(super) fn validate_retained(
    messages: &[StoredMessage],
    allow_developer: bool,
) -> Result<(), CompactionFailure> {
    let mut pending = std::collections::HashSet::new();
    let mut used = std::collections::HashSet::new();
    for message in messages {
        let content = match message {
            StoredMessage::Developer { text } => {
                if !allow_developer || text.is_empty() || !pending.is_empty() {
                    return Err(CompactionFailure::InvalidOutput);
                }
                None
            }
            StoredMessage::User {
                content,
                source_item_id,
            } => {
                if source_item_id.is_some_and(|id| id.is_nil()) {
                    return Err(CompactionFailure::InvalidOutput);
                }
                if !pending.is_empty() {
                    return Err(CompactionFailure::InvalidOutput);
                }
                Some(content)
            }
            StoredMessage::Assistant {
                content,
                tool_calls,
                ..
            } => {
                for call in tool_calls {
                    if call.call_id.is_empty()
                        || call.name.is_empty()
                        || call.raw_arguments_json.as_deref().is_some_and(|raw| {
                            !serde_json::from_str::<serde_json::Value>(raw)
                                .is_ok_and(|value| value == call.arguments)
                        })
                        || !used.insert(&call.call_id)
                        || !pending.insert(&call.call_id)
                    {
                        return Err(CompactionFailure::InvalidOutput);
                    }
                }
                Some(content)
            }
            StoredMessage::CanonicalOutput { item } => {
                item.validate()
                    .map_err(|_| CompactionFailure::InvalidOutput)?;
                if let Some(crate::model::ModelOutputItem::ToolCall(call)) = &item.normalized
                    && (!used.insert(&call.call_id) || !pending.insert(&call.call_id))
                {
                    return Err(CompactionFailure::InvalidOutput);
                }
                None
            }
            StoredMessage::ToolResult { call_id, .. } => {
                if !pending.remove(call_id) {
                    return Err(CompactionFailure::InvalidOutput);
                }
                None
            }
        };
        if content.is_some_and(|parts| {
            parts.iter().any(|part| {
                matches!(part,
            StoredContent::Image { media_type, sha256, byte_length }
                if media_type.trim().is_empty() || *byte_length == 0 || sha256.len() != 64
                    || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()))
            })
        }) {
            return Err(CompactionFailure::InvalidOutput);
        }
    }
    if !pending.is_empty() {
        return Err(CompactionFailure::InvalidOutput);
    }
    Ok(())
}

pub fn store_messages(messages: &[ModelMessage]) -> Result<Vec<StoredMessage>, CompactionFailure> {
    messages
        .iter()
        .map(|message| {
            Ok(match message {
                ModelMessage::System(_) => return Err(CompactionFailure::InvalidOutput),
                ModelMessage::Developer(text) => StoredMessage::Developer { text: text.clone() },
                ModelMessage::CanonicalOutput(item) => {
                    item.validate()
                        .map_err(|_| CompactionFailure::InvalidOutput)?;
                    StoredMessage::CanonicalOutput { item: item.clone() }
                }
                ModelMessage::User {
                    content,
                    source_item_id,
                } => StoredMessage::User {
                    content: store_parts(content),
                    source_item_id: *source_item_id,
                },
                ModelMessage::Assistant {
                    content,
                    tool_calls,
                    phase,
                } => StoredMessage::Assistant {
                    content: store_parts(content),
                    phase: *phase,
                    tool_calls: tool_calls
                        .iter()
                        .map(|call| StoredCall {
                            call_id: call.call_id.clone(),
                            name: call.name.clone(),
                            namespace: call.namespace.clone(),
                            arguments: call.arguments.clone(),
                            raw_arguments_json: call.raw_arguments_json.clone(),
                        })
                        .collect(),
                },
                ModelMessage::ToolResult {
                    call_id,
                    content,
                    is_error,
                } => StoredMessage::ToolResult {
                    call_id: call_id.clone(),
                    content: content.clone(),
                    is_error: *is_error,
                },
            })
        })
        .collect()
}

fn store_parts(parts: &[ContentPart]) -> Vec<StoredContent> {
    parts
        .iter()
        .map(|part| match part {
            ContentPart::Text(text) => StoredContent::Text { text: text.clone() },
            ContentPart::Image { media_type, bytes } => StoredContent::Image {
                media_type: media_type.clone(),
                sha256: format!("{:x}", Sha256::digest(bytes)),
                byte_length: bytes.len() as u64,
            },
        })
        .collect()
}

/// The host resolves a hash to existing authorized binary data, without reading
/// arbitrary paths supplied by a checkpoint or duplicating binaries into SQLite.
pub fn restore_messages(
    messages: &[StoredMessage],
    images: &dyn Fn(&str) -> Option<Arc<[u8]>>,
) -> Result<Vec<ModelMessage>, CompactionFailure> {
    let parts = |content: &[StoredContent]| {
        content
            .iter()
            .map(|part| {
                Ok(match part {
                    StoredContent::Text { text } => ContentPart::Text(text.clone()),
                    StoredContent::Image {
                        media_type,
                        sha256,
                        byte_length,
                    } => {
                        let bytes = images(sha256).ok_or(CompactionFailure::InvalidOutput)?;
                        if bytes.len() as u64 != *byte_length
                            || format!("{:x}", Sha256::digest(&bytes)) != *sha256
                        {
                            return Err(CompactionFailure::InvalidOutput);
                        }
                        ContentPart::Image {
                            media_type: media_type.clone(),
                            bytes,
                        }
                    }
                })
            })
            .collect::<Result<Vec<_>, CompactionFailure>>()
    };
    messages
        .iter()
        .map(|message| {
            Ok(match message {
                StoredMessage::Developer { text } => ModelMessage::Developer(text.clone()),
                StoredMessage::CanonicalOutput { item } => {
                    item.validate()
                        .map_err(|_| CompactionFailure::InvalidOutput)?;
                    ModelMessage::CanonicalOutput(item.clone())
                }
                StoredMessage::User {
                    content,
                    source_item_id,
                } => ModelMessage::User {
                    content: parts(content)?,
                    source_item_id: *source_item_id,
                },
                StoredMessage::Assistant {
                    content,
                    tool_calls,
                    phase,
                } => ModelMessage::Assistant {
                    content: parts(content)?,
                    phase: *phase,
                    tool_calls: tool_calls
                        .iter()
                        .map(|call| ToolCall {
                            call_id: call.call_id.clone(),
                            name: call.name.clone(),
                            namespace: call.namespace.clone(),
                            arguments: call.arguments.clone(),
                            raw_arguments_json: call.raw_arguments_json.clone(),
                        })
                        .collect(),
                },
                StoredMessage::ToolResult {
                    call_id,
                    content,
                    is_error,
                } => ModelMessage::ToolResult {
                    call_id: call_id.clone(),
                    content: content.clone(),
                    is_error: *is_error,
                },
            })
        })
        .collect()
}
