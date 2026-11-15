//! Portable transcript, not a runtime checkpoint or a database backup.
use super::ConversationSummary;
use crate::protocol::{ConversationProjection, ItemKind, ModelIdentity, TurnOutcome, TurnPhase};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationExport {
    pub format: &'static str,
    pub schema_version: u8,
    pub conversation: ExportMetadata,
    pub watermark: u64,
    pub turns: Vec<ExportTurn>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMetadata {
    pub id: Uuid,
    pub title: String,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTurn {
    pub id: Uuid,
    pub context_snapshot_id: Uuid,
    pub model: ModelIdentity,
    pub phase: TurnPhase,
    pub outcome: Option<TurnOutcome>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub items: Vec<ExportItem>,
    pub attempts: Vec<ExportAttempt>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAttempt {
    pub id: Uuid,
    pub requested_model: ModelIdentity,
    pub actual_model: Option<ModelIdentity>,
    pub outcome: Option<TurnOutcome>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportItem {
    pub id: Uuid,
    pub kind: ExportItemKind,
    pub text: String,
    pub completed: bool,
    pub interrupted: bool,
}

/// A closed public representation: adding private fields to runtime item kinds
/// must never silently expand the exported format.
#[derive(Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExportItemKind {
    ContextCompaction,
    UserMessage,
    HookPrompt {
        invocation_id: Uuid,
        fragments: Vec<crate::protocol::HookPromptFragment>,
    },
    AssistantMessage,
    ReasoningSummary {
        parts: Vec<crate::protocol::ReasoningSummaryPart>,
    },
    ProviderNative {
        item_type: String,
    },
    ToolCall {
        call_id: Uuid,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        namespace: Option<String>,
    },
    ToolResult {
        call_id: Uuid,
        is_error: Option<bool>,
    },
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConversationExportError {
    #[error("conversation export does not match its durable snapshot")]
    Mismatch,
    #[error("conversation export metadata is invalid")]
    InvalidMetadata,
}

impl ConversationExport {
    /// Caller supplies a projection and metadata from one read snapshot. This
    /// operation neither recovers unfinished turns nor authorizes replay.
    pub fn from_projection(
        summary: ConversationSummary,
        projection: &ConversationProjection,
    ) -> Result<Self, ConversationExportError> {
        if summary.id != projection.conversation_id() || summary.durable_count != projection.seq() {
            return Err(ConversationExportError::Mismatch);
        }
        if summary.title.trim().is_empty()
            || summary.title.chars().count() > 180
            || summary.title.contains('\0')
            || summary.id.as_uuid().is_nil()
        {
            return Err(ConversationExportError::InvalidMetadata);
        }
        let mut turns = Vec::new();
        for id in projection.turn_order() {
            let turn = projection
                .turn(*id)
                .ok_or(ConversationExportError::Mismatch)?;
            let mut items = Vec::new();
            for id in &turn.item_order {
                let item = turn
                    .items
                    .get(id)
                    .ok_or(ConversationExportError::Mismatch)?;
                // The application call ID pairs tools. Provider routing IDs are
                // transport details and must not become portable identities.
                let mut text = item.text.clone();
                let kind = match &item.kind {
                    ItemKind::ContextCompaction => ExportItemKind::ContextCompaction,
                    ItemKind::UserMessage => ExportItemKind::UserMessage,
                    ItemKind::HookPrompt {
                        invocation_id,
                        fragments,
                    } => ExportItemKind::HookPrompt {
                        invocation_id: *invocation_id,
                        fragments: fragments.clone(),
                    },
                    ItemKind::AssistantMessage => ExportItemKind::AssistantMessage,
                    ItemKind::ReasoningSummary { parts } => {
                        let parts = if let Some(draft) =
                            item.reasoning_draft.as_ref().filter(|_| !item.completed)
                        {
                            let (body, parts) = draft.snapshot();
                            text = body;
                            parts
                        } else {
                            parts.clone()
                        };
                        ExportItemKind::ReasoningSummary { parts }
                    }
                    ItemKind::ProviderNative { item_type } => ExportItemKind::ProviderNative {
                        item_type: item_type.clone(),
                    },
                    ItemKind::ToolCall {
                        call_id,
                        name,
                        namespace,
                        ..
                    } => ExportItemKind::ToolCall {
                        call_id: *call_id,
                        name: name.clone(),
                        namespace: namespace.clone(),
                    },
                    ItemKind::ToolResult { call_id, is_error } => ExportItemKind::ToolResult {
                        call_id: *call_id,
                        is_error: *is_error,
                    },
                };
                items.push(ExportItem {
                    id: *id,
                    kind,
                    text,
                    completed: item.completed,
                    interrupted: item.interrupted,
                });
            }
            let mut attempts = Vec::new();
            for id in &turn.attempt_order {
                let attempt = turn
                    .attempts
                    .get(id)
                    .ok_or(ConversationExportError::Mismatch)?;
                attempts.push(ExportAttempt {
                    id: *id,
                    requested_model: attempt.requested_model.clone(),
                    actual_model: attempt.actual_model.clone(),
                    outcome: attempt.outcome,
                    input_tokens: attempt.input_tokens,
                    output_tokens: attempt.output_tokens,
                });
            }
            turns.push(ExportTurn {
                id: *id,
                context_snapshot_id: turn.context_snapshot_id,
                model: turn.model.clone(),
                phase: turn.phase,
                outcome: turn.outcome,
                input_tokens: turn.input_tokens,
                output_tokens: turn.output_tokens,
                items,
                attempts,
            });
        }
        Ok(Self {
            format: "research-assistant.conversation",
            schema_version: 1,
            watermark: projection.seq(),
            conversation: ExportMetadata {
                id: *summary.id.as_uuid(),
                title: summary.title,
                archived: summary.archived,
                created_at: summary.created_at,
                updated_at: summary.updated_at,
            },
            turns,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::ConversationId;

    #[test]
    fn metadata_must_match_the_projection_identity_and_watermark() {
        let id = ConversationId::from_uuid(Uuid::from_u128(1));
        let projection = ConversationProjection::new(id);
        let summary = ConversationSummary {
            internal: false,
            id,
            title: "Title".into(),
            archived: false,
            durable_count: 0,
            created_at: "2026-09-10T00:00:00.000Z".into(),
            updated_at: "2026-09-10T00:00:00.000Z".into(),
        };
        let exported = ConversationExport::from_projection(summary.clone(), &projection).unwrap();
        assert_eq!(exported.watermark, 0);
        assert!(exported.turns.is_empty());
        let mut changed = summary.clone();
        changed.durable_count = 1;
        assert!(matches!(
            ConversationExport::from_projection(changed, &projection),
            Err(ConversationExportError::Mismatch)
        ));
        let mut changed = summary.clone();
        changed.id = ConversationId::from_uuid(Uuid::from_u128(2));
        assert!(matches!(
            ConversationExport::from_projection(changed, &projection),
            Err(ConversationExportError::Mismatch)
        ));
        let mut changed = summary;
        changed.title = " ".into();
        assert!(matches!(
            ConversationExport::from_projection(changed, &projection),
            Err(ConversationExportError::InvalidMetadata)
        ));
    }
}
