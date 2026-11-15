//! Adapted from OpenAI Codex core/src/context/token_budget_context.rs,
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b, Apache-2.0.
//! Copyright 2025 OpenAI. Host supplies durable identities and approved hints;
//! this fragment neither reads memory nor advances the window.
use crate::model::{ModelError, ModelMessage};
use uuid::Uuid;

pub struct TokenBudgetContext {
    pub conversation_id: Uuid,
    pub first_window_id: Uuid,
    pub previous_window_id: Option<Uuid>,
    pub window_id: Uuid,
    pub thread_hint: Option<String>,
}
impl TokenBudgetContext {
    /// Decode only the reserved full-context envelope. The caller must already
    /// have established developer provenance; this does not promote user text.
    pub fn from_body(body: &str) -> Result<Option<Self>, ModelError> {
        let Some(body) = body.strip_prefix("<context_window>\n") else {
            return Ok(None);
        };
        let body = body
            .strip_suffix("\n</context_window>")
            .ok_or(ModelError::InvalidRequest)?;
        let mut lines = body.splitn(4, '\n');
        let mut identity = |prefix: &str| -> Result<Uuid, ModelError> {
            lines
                .next()
                .and_then(|line| line.strip_prefix(prefix))
                .and_then(|id| Uuid::parse_str(id).ok())
                .filter(|id| !id.is_nil())
                .ok_or(ModelError::InvalidRequest)
        };
        let conversation_id = identity("Thread id: ")?;
        let first_window_id = identity("First context window id: ")?;
        let window_id = identity("Current context window id: ")?;
        let remaining = lines.next();
        let (previous_window_id, thread_hint) = match remaining {
            Some(body)
                if first_window_id != window_id
                    && body.starts_with("Previous context window id: ") =>
            {
                let (line, hint) = body
                    .split_once('\n')
                    .map_or((body, None), |(line, hint)| (line, Some(hint.to_owned())));
                let id = line
                    .strip_prefix("Previous context window id: ")
                    .and_then(|id| Uuid::parse_str(id).ok())
                    .filter(|id| !id.is_nil())
                    .ok_or(ModelError::InvalidRequest)?;
                (Some(id), hint)
            }
            body => (None, body.map(str::to_owned)),
        };
        Ok(Some(Self {
            conversation_id,
            first_window_id,
            previous_window_id,
            window_id,
            thread_hint,
        }))
    }
    /// Full-context metadata only. Hosts must not append this to steady-state
    /// diffs or reinterpret user-authored tags as trusted developer messages.
    pub fn into_message(self) -> ModelMessage {
        let mut lines = vec![
            format!("Thread id: {}", self.conversation_id),
            format!("First context window id: {}", self.first_window_id),
            format!("Current context window id: {}", self.window_id),
        ];
        if let Some(previous) = self.previous_window_id {
            lines.push(format!("Previous context window id: {previous}"));
        }
        if let Some(hint) = self.thread_hint {
            lines.push(hint);
        }
        ModelMessage::Developer(format!(
            "<context_window>\n{}\n</context_window>",
            lines.join("\n")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initial_window_has_no_previous_or_hint_and_uses_developer_role() {
        let message = TokenBudgetContext {
            conversation_id: Uuid::from_u128(1),
            first_window_id: Uuid::from_u128(2),
            previous_window_id: None,
            window_id: Uuid::from_u128(2),
            thread_hint: None,
        }
        .into_message();
        assert!(
            matches!(message, ModelMessage::Developer(ref body) if body == concat!(
            "<context_window>\n",
            "Thread id: 00000000-0000-0000-0000-000000000001\n",
            "First context window id: 00000000-0000-0000-0000-000000000002\n",
            "Current context window id: 00000000-0000-0000-0000-000000000002\n",
            "</context_window>"))
        );
    }
    #[test]
    fn reset_window_keeps_pinned_field_order_and_verbatim_host_hint() {
        let message = TokenBudgetContext {
            conversation_id: Uuid::from_u128(1),
            first_window_id: Uuid::from_u128(2),
            previous_window_id: Some(Uuid::from_u128(3)),
            window_id: Uuid::from_u128(4),
            thread_hint: Some("  durable notes\nsource anchors  ".into()),
        }
        .into_message();
        let ModelMessage::Developer(body) = message else {
            panic!("wrong role")
        };
        assert!(body.contains(concat!(
            "Current context window id: 00000000-0000-0000-0000-000000000004\n",
            "Previous context window id: 00000000-0000-0000-0000-000000000003\n",
            "  durable notes\nsource anchors  \n</context_window>"
        )));
        let restored = TokenBudgetContext::from_body(&body).unwrap().unwrap();
        assert_eq!(
            restored.thread_hint.as_deref(),
            Some("  durable notes\nsource anchors  ")
        );
        assert!(
            matches!(restored.into_message(), ModelMessage::Developer(replayed) if replayed == body)
        );
    }
    #[test]
    fn reserved_metadata_rejects_malformed_identity_and_unrelated_text_is_untouched() {
        assert!(
            TokenBudgetContext::from_body("ordinary developer guidance")
                .unwrap()
                .is_none()
        );
        assert!(
            TokenBudgetContext::from_body(
                "<context_window>\nThread id: invalid\n</context_window>"
            )
            .is_err()
        );
        assert!(TokenBudgetContext::from_body("<context_window>\nThread id: 00000000-0000-0000-0000-000000000000\n</context_window>").is_err());
    }
    #[test]
    fn initial_hint_cannot_be_mistaken_for_previous_window_identity() {
        let hint = "Previous context window id: notes are text, not identity";
        let ModelMessage::Developer(body) = (TokenBudgetContext {
            conversation_id: Uuid::from_u128(1),
            first_window_id: Uuid::from_u128(2),
            previous_window_id: None,
            window_id: Uuid::from_u128(2),
            thread_hint: Some(hint.into()),
        })
        .into_message() else {
            panic!("developer role expected")
        };
        let decoded = TokenBudgetContext::from_body(&body).unwrap().unwrap();
        assert_eq!(decoded.previous_window_id, None);
        assert_eq!(decoded.thread_hint.as_deref(), Some(hint));
    }
}
