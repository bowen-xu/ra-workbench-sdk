//! Adapted from Codex core/src/stream_events_utils.rs and session/turn.rs,
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0, Copyright 2025
//! OpenAI). This application has no Codex plan-mode marker semantics.
use crate::model::{ModelOutputItem, ModelResponse};

fn visible_message(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }
    let (visible, _) = super::codex_stream_parser::strip_citations(text);
    (!visible.trim().is_empty()).then_some(visible)
}

/// Last nonempty assistant message in this response, with Codex hidden memory
/// citations removed. Legacy Chat responses have only one aggregate text item.
pub fn stop_hook_last_assistant_message(response: &ModelResponse) -> Option<String> {
    let has_items = response
        .output
        .iter()
        .any(|item| matches!(item, ModelOutputItem::Message(_)));
    if has_items {
        response.output.iter().rev().find_map(|item| match item {
            ModelOutputItem::Message(message) => visible_message(&message.text),
            _ => None,
        })
    } else {
        visible_message(&response.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        model::{AssistantMessage, ModelUsage},
        protocol::ModelIdentity,
    };

    fn response(text: &str, messages: &[&str]) -> ModelResponse {
        ModelResponse {
            response_id: "response".into(),
            actual_model: ModelIdentity {
                provider_id: "test".into(),
                model_id: "test".into(),
                revision: None,
            },
            actual_model_observed: false,
            text: text.into(),
            output: messages
                .iter()
                .enumerate()
                .map(|(i, text)| {
                    ModelOutputItem::Message(AssistantMessage {
                        item_id: i.to_string(),
                        text: (*text).into(),
                        phase: None,
                    })
                })
                .collect(),
            tool_calls: vec![],
            usage: ModelUsage {
                input_tokens: None,
                output_tokens: None,
            },
            end_turn: None,
        }
    }

    #[test]
    fn uses_last_visible_item_not_the_concatenated_response() {
        let value = response(
            "not authoritative",
            &[
                "first",
                "second<oai-mem-citation>private</oai-mem-citation> tail",
                "  ",
            ],
        );
        assert_eq!(
            stop_hook_last_assistant_message(&value).as_deref(),
            Some("second tail")
        );
        assert_eq!(
            stop_hook_last_assistant_message(&response(
                "not fallback",
                &["<oai-mem-citation>x</oai-mem-citation>"]
            )),
            None
        );
    }

    #[test]
    fn legacy_text_preserves_whitespace_and_upstream_tag_eof_rules() {
        assert_eq!(
            stop_hook_last_assistant_message(&response(" before <oai-mem-citation>hidden", &[]))
                .as_deref(),
            Some(" before ")
        );
        assert_eq!(
            stop_hook_last_assistant_message(&response("partial <oai-mem-", &[])).as_deref(),
            Some("partial <oai-mem-")
        );
        assert_eq!(
            stop_hook_last_assistant_message(&response(" \n ", &[])),
            None
        );
    }
}
