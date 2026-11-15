use research_agent_core::{conversation::ConversationId, model::*, protocol::*};
use uuid::Uuid;

#[path = "model_history/fragments.rs"]
mod fragments;

struct History {
    projection: ConversationProjection,
    turn: Uuid,
    next: u128,
}
impl History {
    fn new() -> Self {
        Self {
            projection: ConversationProjection::new(ConversationId::from_uuid(Uuid::from_u128(1))),
            turn: Uuid::nil(),
            next: 10,
        }
    }
    fn emit(&mut self, payload: EventPayload) {
        let event: AgentEvent = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1, "conversationId": Uuid::from_u128(1),
            "seq": self.projection.seq() + 1, "timestampMs": 1,
            "requestId": Uuid::from_u128(2), "payload": payload
        }))
        .unwrap();
        self.projection.apply(&event).unwrap();
    }
    fn begin(&mut self) {
        self.next += 1;
        self.turn = Uuid::from_u128(self.next);
        self.emit(EventPayload::TurnStarted {
            task_kind: research_agent_core::protocol::TaskKind::Regular,
            turn_id: self.turn,
            context_snapshot_id: Uuid::from_u128(3),
            model: model(),
        });
    }
    fn item(&mut self, kind: ItemKind, text: &str, complete: bool) {
        self.next += 1;
        let item_id = Uuid::from_u128(self.next);
        self.emit(EventPayload::ItemStarted {
            turn_id: self.turn,
            item_id,
            kind,
        });
        if !text.is_empty() {
            self.emit(EventPayload::TextDelta {
                turn_id: self.turn,
                item_id,
                text: text.into(),
            });
        }
        if complete {
            self.emit(EventPayload::ItemCompleted {
                turn_id: self.turn,
                item_id,
            });
        }
    }
    fn end(&mut self, outcome: TurnOutcome) {
        self.emit(EventPayload::TurnFinished {
            turn_id: self.turn,
            outcome,
        });
    }
    fn call(&mut self, id: u128) {
        self.item(
            ItemKind::ToolCall {
                call_id: Uuid::from_u128(id),
                name: "read".into(),
                provider_call_id: Some(format!("provider-{id}")),
                namespace: None,
            },
            "{}",
            true,
        );
    }
    fn result(&mut self, id: u128) {
        self.item(
            ItemKind::ToolResult {
                call_id: Uuid::from_u128(id),
                is_error: Some(false),
            },
            "evidence",
            true,
        );
    }
}
fn model() -> ModelIdentity {
    ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "fixture".into(),
        revision: None,
    }
}
fn validate(messages: Vec<ModelMessage>) {
    ModelRequest {
        captured_history: None,
        request_id: Uuid::from_u128(9),
        model: model(),
        messages,
        tools: vec![],
        max_output_tokens: 100,
        parallel_tool_calls: false,
        reasoning_effort: None,
    }
    .validate(ModelCapabilities {
        vision: false,
        tools: true,
        parallel_tools: true,
        reasoning_efforts: vec![],
    })
    .unwrap();
}

#[test]
fn hook_prompt_replays_ordered_parts_as_model_input_without_becoming_a_user_boundary() {
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::UserMessage, "question", true);
    h.item(ItemKind::AssistantMessage, "draft answer", true);
    let item_id = Uuid::from_u128(90);
    let fragments = vec![
        HookPromptFragment {
            run_id: Uuid::from_u128(91),
            input_text: "<hook_prompt hook_run_id=\"91\">first</hook_prompt>".into(),
        },
        HookPromptFragment {
            run_id: Uuid::from_u128(92),
            input_text: "<hook_prompt hook_run_id=\"92\">second</hook_prompt>".into(),
        },
    ];
    h.emit(EventPayload::ItemAccepted {
        turn_id: h.turn,
        item_id,
        kind: ItemKind::HookPrompt {
            invocation_id: Uuid::from_u128(93),
            fragments: fragments.clone(),
        },
        text: String::new(),
        phase: None,
        source: None,
    });
    h.item(ItemKind::AssistantMessage, "revised", true);
    h.end(TurnOutcome::Completed);
    let messages = reconstruct_history(&h.projection).unwrap();
    assert_eq!(messages.len(), 4);
    assert!(
        messages[2]
            == ModelMessage::User {
                source_item_id: Some(item_id),
                content: fragments
                    .iter()
                    .map(|part| ContentPart::Text(part.input_text.clone()))
                    .collect()
            }
    );
    validate(messages);
    // A later hook-only turn is not another user turn for rollback counting.
    h.begin();
    h.emit(EventPayload::ItemAccepted {
        turn_id: h.turn,
        item_id: Uuid::from_u128(94),
        kind: ItemKind::HookPrompt {
            invocation_id: Uuid::from_u128(95),
            fragments,
        },
        text: String::new(),
        phase: None,
        source: None,
    });
    h.end(TurnOutcome::Completed);
    h.emit(EventPayload::ConversationRolledBack {
        turn_id: h.turn,
        user_turns: 1,
    });
    assert!(h.projection.turn_order().is_empty());
}

#[test]
fn replays_parallel_and_serial_calls_with_unique_ids_across_turns() {
    let mut h = History::new();
    for _ in 0..2 {
        h.begin();
        h.item(ItemKind::UserMessage, "question", true);
        h.item(ItemKind::AssistantMessage, "checking", true);
        h.call(100);
        h.call(101);
        h.result(101);
        h.result(100);
        h.call(102);
        h.result(102);
        h.item(ItemKind::AssistantMessage, "answer", true);
        h.end(TurnOutcome::Completed);
    }
    let before = h.projection.clone();
    let messages = reconstruct_history(&h.projection).unwrap();
    assert_eq!(messages.len(), 18);
    let ModelMessage::CanonicalOutput(first_call) = &messages[2] else {
        panic!()
    };
    let ModelMessage::CanonicalOutput(second_call) = &messages[3] else {
        panic!()
    };
    let Some(ModelOutputItem::ToolCall(first_call)) = &first_call.normalized else {
        panic!()
    };
    let Some(ModelOutputItem::ToolCall(second_call)) = &second_call.normalized else {
        panic!()
    };
    assert_ne!(first_call.call_id, second_call.call_id);
    let ModelMessage::ToolResult {
        call_id,
        content,
        is_error,
    } = &messages[4]
    else {
        panic!()
    };
    assert_eq!(call_id, &second_call.call_id);
    assert_eq!(content, "evidence");
    assert!(!is_error);
    validate(messages);
    assert_eq!(h.projection, before);
}

#[test]
fn missing_result_is_explicitly_unknown_and_does_not_modify_history() {
    let mut h = History::new();
    h.begin();
    h.call(100);
    h.end(TurnOutcome::Interrupted);
    let before = h.projection.clone();
    let messages = reconstruct_history(&h.projection).unwrap();
    let ModelMessage::ToolResult {
        content, is_error, ..
    } = &messages[1]
    else {
        panic!()
    };
    assert!(content.contains("outcome is unknown"));
    assert!(*is_error);
    validate(messages);
    assert_eq!(h.projection, before);
}

#[test]
fn keeps_unknown_tool_output_but_omits_incomplete_assistant_drafts() {
    let mut h = History::new();
    h.begin();
    h.call(100);
    h.item(
        ItemKind::ToolResult {
            call_id: Uuid::from_u128(100),
            is_error: Some(false),
        },
        "partial output",
        false,
    );
    h.item(ItemKind::AssistantMessage, "partial answer", false);
    h.end(TurnOutcome::Canceled);
    let messages = reconstruct_history(&h.projection).unwrap();
    let ModelMessage::ToolResult {
        content, is_error, ..
    } = &messages[1]
    else {
        panic!()
    };
    assert!(content.starts_with("partial output"));
    assert!(*is_error);
    assert_eq!(messages.len(), 2);
    validate(messages);
}

#[test]
fn rejects_active_history_and_incomplete_input() {
    let mut h = History::new();
    h.begin();
    assert!(matches!(
        reconstruct_history(&h.projection),
        Err(HistoryError::ActiveTurn)
    ));
    h.item(ItemKind::UserMessage, "partial", false);
    h.end(TurnOutcome::Interrupted);
    assert!(matches!(
        reconstruct_history(&h.projection),
        Err(HistoryError::IncompleteInput)
    ));
}

#[test]
fn legacy_malformed_tool_intent_keeps_original_arguments_and_explicit_unknown_result() {
    let mut h = History::new();
    h.begin();
    h.item(
        ItemKind::ToolCall {
            call_id: Uuid::from_u128(100),
            name: "read".into(),
            provider_call_id: None,
            namespace: None,
        },
        "{",
        true,
    );
    h.end(TurnOutcome::Failed);
    let restored = reconstruct_history(&h.projection).unwrap();
    assert!(matches!(&restored[0],ModelMessage::CanonicalOutput(item)
        if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call))if call.raw_arguments_json=="{")));
    assert!(matches!(
        &restored[1],
        ModelMessage::ToolResult { is_error: true, .. }
    ));
}

#[test]
fn continuation_omits_an_interrupted_tool_call_without_replaying_it() {
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::UserMessage, "question", true);
    h.item(
        ItemKind::ToolCall {
            call_id: Uuid::from_u128(100),
            name: "write".into(),
            provider_call_id: None,
            namespace: None,
        },
        "{\"path\":\"main.tex\"",
        false,
    );
    h.end(TurnOutcome::Interrupted);
    let messages =
        reconstruct_history_for_continuation(&h.projection, &std::collections::HashMap::new())
            .unwrap();
    assert!(messages.iter().all(|message| !matches!(message, ModelMessage::Assistant { tool_calls, .. } if !tool_calls.is_empty())));
    assert!(messages.iter().any(|message| matches!(message, ModelMessage::Assistant { content, .. } if content.iter().any(|part| matches!(part, ContentPart::Text(text) if text.contains("will not be replayed"))))));
}

#[test]
fn continuation_omits_a_failed_incomplete_tool_call_after_preparation_error() {
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::UserMessage, "question", true);
    h.item(
        ItemKind::ToolCall {
            call_id: Uuid::from_u128(101),
            name: "read".into(),
            provider_call_id: None,
            namespace: None,
        },
        "{\"path\":\"main.tex\"",
        false,
    );
    h.end(TurnOutcome::Failed);
    reconstruct_history_for_continuation(&h.projection, &std::collections::HashMap::new())
        .expect("failed preparation turns must remain resumable without replay");
}

#[test]
fn legacy_result_keeps_content_and_exposes_unknown_status() {
    let mut h = History::new();
    h.begin();
    h.call(100);
    h.item(
        ItemKind::ToolResult {
            call_id: Uuid::from_u128(100),
            is_error: None,
        },
        "legacy evidence",
        true,
    );
    h.end(TurnOutcome::Completed);
    let messages = reconstruct_history(&h.projection).unwrap();
    let ModelMessage::ToolResult {
        content, is_error, ..
    } = &messages[1]
    else {
        panic!()
    };
    assert!(content.starts_with("legacy evidence"));
    assert!(content.contains("status was not recorded"));
    assert!(*is_error);
    validate(messages);
}

#[test]
fn does_not_move_a_real_result_across_user_input() {
    let mut h = History::new();
    h.begin();
    h.call(100);
    h.item(ItemKind::UserMessage, "steering", true);
    h.result(100);
    h.end(TurnOutcome::Completed);
    assert!(matches!(
        reconstruct_history(&h.projection),
        Err(HistoryError::InvalidOrder)
    ));
}

#[test]
fn never_attaches_a_new_turn_call_to_a_previous_turn_answer() {
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::AssistantMessage, "previous answer", true);
    h.end(TurnOutcome::Completed);
    h.begin();
    h.call(100);
    h.result(100);
    h.end(TurnOutcome::Completed);
    let messages = reconstruct_history(&h.projection).unwrap();
    let ModelMessage::CanonicalOutput(previous) = &messages[0] else {
        panic!()
    };
    assert!(
        matches!(&previous.normalized, Some(ModelOutputItem::Message(message)) if message.text == "previous answer")
    );
    assert_eq!(messages.len(), 3);
    validate(messages);
}

#[test]
fn context_stays_at_its_turn_as_user_content_and_unknown_turns_are_rejected() {
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::UserMessage, "question", true);
    h.end(TurnOutcome::Completed);
    let mut context = std::collections::HashMap::from([(
        h.turn,
        vec![ContentPart::Text("frozen evidence".into())],
    )]);
    let messages = reconstruct_history_with_context(&h.projection, &context).unwrap();
    assert_eq!(messages.len(), 2);
    assert!(
        matches!(&messages[0], ModelMessage::User { content: parts, .. } if matches!(&parts[0], ContentPart::Text(text) if text == "frozen evidence"))
    );
    assert!(
        matches!(&messages[1], ModelMessage::User { content: parts, .. } if matches!(&parts[0], ContentPart::Text(text) if text == "question"))
    );
    context.insert(
        Uuid::from_u128(999),
        vec![ContentPart::Text("wrong scope".into())],
    );
    assert!(matches!(
        reconstruct_history_with_context(&h.projection, &context),
        Err(HistoryError::InvalidOrder)
    ));
}

#[test]
fn compact_task_context_is_not_replayed_as_user_input() {
    let mut history = History::new();
    history.begin();
    history.item(ItemKind::UserMessage, "original user", true);
    history.end(TurnOutcome::Completed);
    history.next += 1;
    history.turn = Uuid::from_u128(history.next);
    history.emit(EventPayload::TurnStarted {
        task_kind: TaskKind::Compact,
        turn_id: history.turn,
        context_snapshot_id: Uuid::from_u128(3),
        model: model(),
    });
    history.end(TurnOutcome::Completed);
    let contexts = std::collections::HashMap::from([(
        history.turn,
        vec![ContentPart::Text("command-only authority".into())],
    )]);
    let messages = reconstruct_history_with_context(&history.projection, &contexts).unwrap();
    assert_eq!(messages.len(), 1);
    assert!(
        matches!(&messages[0], ModelMessage::User { content: parts, .. }
        if matches!(&parts[..], [ContentPart::Text(text)] if text == "original user"))
    );
}

#[test]
fn compaction_lifecycle_is_not_replayed_as_assistant_or_user_context() {
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::UserMessage, "original input", true);
    h.item(ItemKind::ContextCompaction, "", true);
    h.end(TurnOutcome::Completed);
    let messages = reconstruct_history(&h.projection).unwrap();
    assert_eq!(messages.len(), 1);
    assert!(
        matches!(&messages[0], ModelMessage::User { content: parts, .. } if matches!(&parts[0], ContentPart::Text(text) if text == "original input"))
    );
    h.begin();
    h.item(ItemKind::ContextCompaction, "", false);
    h.end(TurnOutcome::Canceled);
    assert_eq!(reconstruct_history(&h.projection).unwrap().len(), 1);
}
