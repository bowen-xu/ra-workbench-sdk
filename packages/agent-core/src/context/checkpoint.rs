//! Durable replacement-window boundary adapted from Apache-2.0 Codex
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b core/src/compact.rs,
//! compact_remote_v2.rs and context_manager/history.rs. Copyright 2025 OpenAI.
//! Host adapters own atomic journal/window installation and binary storage.

use super::compaction_strategy::{
    CompactionBinding, CompactionFailure, CompactionOutput, CompactionPhase,
};
use crate::{
    model::{ContentPart, ModelMessage, ToolCall},
    protocol::AssistantMessagePhase,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum StoredContent {
    Text {
        text: String,
    },
    Image {
        media_type: String,
        sha256: String,
        byte_length: u64,
    },
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case", deny_unknown_fields)]
pub enum StoredMessage {
    Developer {
        text: String,
    },
    User {
        content: Vec<StoredContent>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_item_id: Option<Uuid>,
    },
    Assistant {
        content: Vec<StoredContent>,
        tool_calls: Vec<StoredCall>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phase: Option<AssistantMessagePhase>,
    },
    CanonicalOutput {
        item: Box<crate::model::CompletedModelItem>,
    },
    ToolResult {
        call_id: String,
        content: String,
        is_error: bool,
    },
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredCall {
    pub call_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub arguments: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_arguments_json: Option<String>,
}

/// Rules are rebuilt by the current authoritative context owner, never taken
/// from a saved model summary. Images reference existing immutable binary data.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextCheckpoint {
    pub schema_version: u32,
    pub window_id: Uuid,
    pub conversation_id: Uuid,
    pub turn_id: Uuid,
    pub source_watermark: u64,
    pub previous_window_id: Option<Uuid>,
    pub binding: CompactionBinding,
    pub credential_scope_id: Option<Uuid>,
    pub phase: CompactionPhase,
    pub output: CompactionOutput,
    pub retained: Vec<StoredMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_context: Option<CanonicalContext>,
}

/// Frozen host-owned context is separate from retained chat history. Schema 3
/// preserves explicit developer fragments; legacy schema 2 keeps user-role
/// context unchanged. Placement follows BeforeLastUserMessage policy.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CanonicalContext {
    pub before_retained: usize,
    pub messages: Vec<StoredMessage>,
}

impl ContextCheckpoint {
    pub fn validate(&self, max_bytes: usize) -> Result<(), CompactionFailure> {
        self.binding.validate()?;
        if !matches!(self.schema_version, 1..=4)
            || self.window_id.is_nil()
            || self.conversation_id.is_nil()
            || self.turn_id.is_nil()
            || (self.source_watermark == 0
                && (self.phase != CompactionPhase::Manual
                    || self.previous_window_id.is_some()
                    || !self.retained.is_empty()))
            || self
                .previous_window_id
                .is_some_and(|id| id.is_nil() || id == self.window_id)
            || self.credential_scope_id.is_some_and(|id| id.is_nil())
        {
            return Err(CompactionFailure::InvalidOutput);
        }
        if self.schema_version == 4
            && (self.binding.kind != super::compaction_strategy::CompactionKind::RemoteWindow
                || self.phase != CompactionPhase::MidTurn
                || !self.retained.is_empty())
        {
            return Err(CompactionFailure::InvalidOutput);
        }
        match (&self.canonical_context, self.schema_version) {
            (None, 1) if self.binding.kind != super::compaction_strategy::CompactionKind::ResetWindow => {}
            (Some(context), 2..=4)
                if self.binding.kind == super::compaction_strategy::CompactionKind::ResetWindow
                    && self.retained.is_empty()
                    && context.before_retained == 0
                    && context.messages.iter().all(|message| {
                        matches!(message, StoredMessage::User { content, .. } if !content.is_empty()) || (self.schema_version >= 3 && matches!(message, StoredMessage::Developer { text } if !text.is_empty()))
                    }) =>
            {
                validate_retained(&context.messages, self.schema_version >= 3)?;
            }
            (Some(context), 2..=4)
                if self.phase == CompactionPhase::MidTurn
                    && matches!(self.binding.kind,
                        super::compaction_strategy::CompactionKind::TextSummary
                        | super::compaction_strategy::CompactionKind::RemoteOpaque
                        | super::compaction_strategy::CompactionKind::RemoteWindow)
                    && context.before_retained == self.retained.iter().rposition(|message| {
                        matches!(message, StoredMessage::User { .. })
                    }).unwrap_or(self.retained.len())
                    && context.messages.iter().all(|message| {
                        matches!(message, StoredMessage::User { content, .. } if !content.is_empty()) || (self.schema_version >= 3 && matches!(message, StoredMessage::Developer { text } if !text.is_empty()))
                    }) =>
            {
                validate_retained(&context.messages, self.schema_version >= 3)?;
            }
            _ => return Err(CompactionFailure::InvalidOutput),
        }
        let matching = matches!(
            (&self.output, self.binding.kind),
            (
                CompactionOutput::ResetWindow,
                super::compaction_strategy::CompactionKind::ResetWindow
            ) | (
                CompactionOutput::TextSummary(_),
                super::compaction_strategy::CompactionKind::TextSummary
            ) | (
                CompactionOutput::RemoteOpaque(_),
                super::compaction_strategy::CompactionKind::RemoteOpaque
            ) | (
                CompactionOutput::RemoteWindow(_),
                super::compaction_strategy::CompactionKind::RemoteWindow
            )
        );
        if !matching {
            return Err(CompactionFailure::Incompatible);
        }
        match &self.output {
            CompactionOutput::ResetWindow if self.credential_scope_id.is_some() => {
                return Err(CompactionFailure::InvalidOutput);
            }
            CompactionOutput::TextSummary(text) if text.trim().is_empty() => {
                return Err(CompactionFailure::InvalidOutput);
            }
            CompactionOutput::RemoteOpaque(item)
                if !item.is_object() || self.credential_scope_id.is_none() =>
            {
                return Err(CompactionFailure::InvalidOutput);
            }
            CompactionOutput::RemoteWindow(items)
                if items.iter().any(|item| !item.is_object())
                    || self.credential_scope_id.is_none()
                    || !self.retained.is_empty() =>
            {
                return Err(CompactionFailure::InvalidOutput);
            }
            _ => {}
        }
        validate_retained(&self.retained, false)?;
        let encoded = serde_json::to_vec(self).map_err(|_| CompactionFailure::InvalidOutput)?;
        if encoded.len() > max_bytes {
            return Err(CompactionFailure::OutputBudget);
        }
        Ok(())
    }

    pub fn require_compatible(
        &self,
        binding: &CompactionBinding,
        credential_scope: Option<Uuid>,
    ) -> Result<(), CompactionFailure> {
        if &self.binding != binding || self.credential_scope_id != credential_scope {
            return Err(CompactionFailure::Incompatible);
        }
        Ok(())
    }

    /// Restore the complete text replacement in its installed order. Current
    /// application rules remain supplied separately by the authoritative owner.
    pub fn restore_text_window(
        &self,
        images: &dyn Fn(&str) -> Option<Arc<[u8]>>,
    ) -> Result<Vec<ModelMessage>, CompactionFailure> {
        self.validate(usize::MAX)?;
        let CompactionOutput::TextSummary(summary) = &self.output else {
            return Err(CompactionFailure::Incompatible);
        };
        let mut messages = self.restore_retained_window(images)?;
        messages.push(ModelMessage::User {
            content: vec![ContentPart::Text(summary.clone())],
            source_item_id: None,
        });
        Ok(messages)
    }

    /// Restore only normalized retained/canonical messages. The injected provider
    /// adapter must validate compatibility and encode opaque state separately;
    /// ciphertext is never a user message or plaintext summary. This does not
    /// restore RemoteWindow, whose complete protocol window needs its own adapter.
    pub fn restore_opaque_messages(
        &self,
        images: &dyn Fn(&str) -> Option<Arc<[u8]>>,
    ) -> Result<Vec<ModelMessage>, CompactionFailure> {
        self.validate(usize::MAX)?;
        if !matches!(self.output, CompactionOutput::RemoteOpaque(_)) {
            return Err(CompactionFailure::Incompatible);
        }
        self.restore_retained_window(images)
    }

    /// A reset restores only authoritative context; it contains no summary or old history.
    pub fn restore_reset_window(
        &self,
        images: &dyn Fn(&str) -> Option<Arc<[u8]>>,
    ) -> Result<Vec<ModelMessage>, CompactionFailure> {
        self.validate(usize::MAX)?;
        if !matches!(self.output, CompactionOutput::ResetWindow) {
            return Err(CompactionFailure::Incompatible);
        }
        self.restore_retained_window(images)
    }

    fn restore_retained_window(
        &self,
        images: &dyn Fn(&str) -> Option<Arc<[u8]>>,
    ) -> Result<Vec<ModelMessage>, CompactionFailure> {
        let mut messages = restore_messages(&self.retained, images)?;
        if let Some(context) = &self.canonical_context {
            let canonical = restore_messages(&context.messages, images)?;
            messages.splice(context.before_retained..context.before_retained, canonical);
        }
        Ok(messages)
    }

    /// Restore only separately captured canonical tail; the provider codec owns
    /// the complete wire window. Never project its objects into plain messages.
    pub fn restore_provider_window_tail(
        &self,
        images: &dyn Fn(&str) -> Option<Arc<[u8]>>,
    ) -> Result<Vec<ModelMessage>, CompactionFailure> {
        self.validate(usize::MAX)?;
        if !matches!(self.output, CompactionOutput::RemoteWindow(_)) {
            return Err(CompactionFailure::Incompatible);
        }
        self.restore_retained_window(images)
    }
}

mod messages;
use messages::validate_retained;
pub use messages::{restore_messages, store_messages};

#[cfg(test)]
#[path = "checkpoint_tests.rs"]
mod tests;
