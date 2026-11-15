use super::*;

fn canonical_message(message: &ModelMessage) -> &AssistantMessage {
    let ModelMessage::CanonicalOutput(item) = message else {
        panic!("canonical output expected")
    };
    let Some(ModelOutputItem::Message(message)) = &item.normalized else {
        panic!("assistant item expected")
    };
    message
}
fn canonical_call(message: &ModelMessage) -> &ToolCallIntent {
    let ModelMessage::CanonicalOutput(item) = message else {
        panic!("canonical output expected")
    };
    let Some(ModelOutputItem::ToolCall(call)) = &item.normalized else {
        panic!("call item expected")
    };
    call
}

fn message(id: &str, text: &str, phase: Option<AssistantMessagePhase>) -> Vec<ModelStreamEvent> {
    vec![
        ModelStreamEvent::AssistantMessageStarted {
            item_id: id.into(),
            phase,
        },
        ModelStreamEvent::AssistantTextDelta {
            item_id: id.into(),
            text: text.into(),
        },
        ModelStreamEvent::AssistantMessageCompleted {
            item_id: id.into(),
            phase,
        },
    ]
}
fn native_answer(
    id: &str,
    text: &str,
    phase: Option<AssistantMessagePhase>,
    end_turn: Option<bool>,
) -> Vec<ModelStreamEvent> {
    let mut events = vec![begin()];
    events.extend(message(id, text, phase));
    events.push(ModelStreamEvent::OutputOrder(vec![
        ModelOutputItemId::Message(id.into()),
    ]));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::Stop,
        end_turn,
    });
    events
}

#[tokio::test]
async fn explicit_end_turn_false_continues_without_tools_and_retains_native_phase() {
    let (transport, sink, ids, request) = setup(vec![
        native_answer(
            "progress",
            "checking",
            Some(AssistantMessagePhase::Commentary),
            Some(false),
        ),
        native_answer(
            "answer",
            "finished",
            Some(AssistantMessagePhase::FinalAnswer),
            Some(true),
        ),
    ]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(
        canonical_message(&requests[1].messages[1]).phase,
        Some(AssistantMessagePhase::Commentary)
    );
    let projection = sink.projection.lock().unwrap();
    let history = reconstruct_history(&projection).unwrap();
    assert_eq!(
        canonical_message(&history[0]).phase,
        Some(AssistantMessagePhase::Commentary)
    );
    assert_eq!(
        canonical_message(&history[1]).phase,
        Some(AssistantMessagePhase::FinalAnswer)
    );
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn commentary_and_unknown_phase_do_not_force_another_request() {
    for phase in [Some(AssistantMessagePhase::Commentary), None] {
        let (transport, sink, ids, request) =
            setup(vec![native_answer("message", "stopped", phase, None)]);
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run(Uuid::from_u128(2), request)
        .await
        .unwrap();
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        let item = &turn.items[&turn.item_order[0]];
        assert_eq!(item.phase, phase);
        assert_eq!(item.native_phase, phase);
    }
}

#[tokio::test]
async fn accepted_item_order_survives_tools_history_and_explicit_end_turn_true() {
    let mut events = vec![begin()];
    // Canonical order freezes at done; terminal output cannot rewrite facts.
    events.extend(message(
        "first",
        "before call",
        Some(AssistantMessagePhase::Commentary),
    ));
    events.extend(call("call-1", "{}"));
    events.extend(message(
        "second",
        "after call",
        Some(AssistantMessagePhase::Commentary),
    ));
    events.push(ModelStreamEvent::OutputOrder(vec![
        ModelOutputItemId::Message("first".into()),
        ModelOutputItemId::ToolCall("call-1".into()),
        ModelOutputItemId::Message("second".into()),
    ]));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: Some(true),
    });
    let (transport, sink, ids, request) = setup(vec![events, answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2, "end_turn=true does not discard tools");
    assert_eq!(
        canonical_message(&requests[1].messages[1]).text,
        "before call"
    );
    assert_eq!(canonical_call(&requests[1].messages[2]).call_id, "call-1");
    assert_eq!(
        canonical_message(&requests[1].messages[3]).text,
        "after call"
    );
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    let items: Vec<_> = turn.item_order.iter().map(|id| &turn.items[id]).collect();
    assert_eq!(items[0].text, "before call");
    assert!(matches!(items[1].kind, ItemKind::ToolCall { .. }));
    assert_eq!(items[2].text, "after call");
    assert!(matches!(items[3].kind, ItemKind::ToolResult { .. }));
    let mut replay = requests[0].clone();
    replay.messages = reconstruct_history(&projection).unwrap();
    replay.validate(transport.capabilities()).unwrap();
    assert_eq!(canonical_message(&replay.messages[2]).text, "after call");
    assert_eq!(
        canonical_message(&replay.messages[2]).phase,
        Some(AssistantMessagePhase::Commentary)
    );
}

#[tokio::test]
async fn failed_response_keeps_done_native_messages_but_interrupts_unfinished_drafts() {
    let mut broken = vec![begin()];
    broken.extend(message(
        "done-part",
        "failed complete item",
        Some(AssistantMessagePhase::Commentary),
    ));
    broken.extend([
        ModelStreamEvent::AssistantMessageStarted {
            item_id: "draft".into(),
            phase: None,
        },
        ModelStreamEvent::AssistantTextDelta {
            item_id: "draft".into(),
            text: "failed draft".into(),
        },
    ]);
    let (transport, sink, ids, request) = setup(vec![
        broken,
        native_answer("answer", "recovered", None, None),
    ]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests[1].messages.len(), requests[0].messages.len() + 1);
    assert_eq!(
        canonical_message(requests[1].messages.last().unwrap()).text,
        "failed complete item"
    );
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    for item in turn
        .items
        .values()
        .filter(|item| item.text.starts_with("failed"))
    {
        assert_eq!(item.completed, item.text == "failed complete item");
        assert_eq!(item.interrupted, item.text == "failed draft");
    }
    let history = reconstruct_history(&projection).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(canonical_message(&history[1]).text, "recovered");
    assert_eq!(canonical_message(&history[1]).phase, None);
}

#[tokio::test]
async fn text_between_two_calls_keeps_native_order_and_both_result_pairs() {
    let mut events = vec![begin()];
    events.extend(call("first-call", "{}"));
    events.extend(message(
        "progress",
        "between calls",
        Some(AssistantMessagePhase::Commentary),
    ));
    events.extend(call("second-call", "{}"));
    events.push(ModelStreamEvent::OutputOrder(vec![
        ModelOutputItemId::ToolCall("first-call".into()),
        ModelOutputItemId::Message("progress".into()),
        ModelOutputItemId::ToolCall("second-call".into()),
    ]));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let (transport, sink, ids, request) = setup(vec![events, answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    assert_eq!(tools.executed.load(Ordering::SeqCst), 2);
    let requests = transport.requests.lock().unwrap();
    let projection = sink.projection.lock().unwrap();
    let mut replay = requests[0].clone();
    replay.messages = reconstruct_history(&projection).unwrap();
    replay.validate(transport.capabilities()).unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    let items: Vec<_> = turn.item_order.iter().map(|id| &turn.items[id]).collect();
    assert!(
        matches!(&items[0].kind, ItemKind::ToolCall { provider_call_id: Some(id), .. } if id == "first-call")
    );
    assert_eq!(items[1].text, "between calls");
    assert!(
        matches!(&items[2].kind, ItemKind::ToolCall { provider_call_id: Some(id), .. } if id == "second-call")
    );
    assert!(matches!(items[3].kind, ItemKind::ToolResult { .. }));
    assert!(matches!(items[4].kind, ItemKind::ToolResult { .. }));
    let mut wrong = requests[1].clone();
    wrong.messages.insert(
        3,
        ModelMessage::User {
            content: vec![ContentPart::Text("cannot overtake pending tools".into())],
            source_item_id: None,
        },
    );
    assert_eq!(
        wrong.validate(transport.capabilities()),
        Err(ModelError::InvalidRequest)
    );
}

#[tokio::test]
async fn legacy_chat_text_before_tools_keeps_replay_equivalent_to_live_request() {
    let mut events = tool_response();
    events.insert(1, ModelStreamEvent::TextDelta("before legacy call".into()));
    let (transport, sink, ids, request) = setup(vec![events, answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.items[&turn.item_order[0]].text, "before legacy call");
    assert!(matches!(
        turn.items[&turn.item_order[1]].kind,
        ItemKind::ToolCall { .. }
    ));
    let replay = reconstruct_history(&projection).unwrap();
    let flatten = |messages: &[ModelMessage]| {
        let mut items = vec![];
        let mut aliases = std::collections::HashMap::new();
        for message in messages {
            match message {
                ModelMessage::CanonicalOutput(item) => {
                    assert!(
                        item.native.is_none(),
                        "legacy Chat has no invented native envelope"
                    );
                    match item.normalized.as_ref().expect("legacy normalized output") {
                        ModelOutputItem::ReasoningSummary(_) => {
                            panic!("legacy fixture has no reasoning summary")
                        }
                        ModelOutputItem::Message(message) => {
                            assert_eq!(
                                message.phase, None,
                                "legacy display phase must not become provider phase"
                            );
                            if !message.text.is_empty() {
                                items.push(format!("text:{}", message.text));
                            }
                        }
                        ModelOutputItem::ToolCall(call) => {
                            let index = aliases.len();
                            aliases.insert(call.call_id.clone(), index);
                            items.push(format!(
                                "call:{index}:{}:{}",
                                call.name, call.raw_arguments_json
                            ));
                        }
                    }
                }
                ModelMessage::Assistant {
                    content,
                    tool_calls,
                    phase,
                } => {
                    assert_eq!(
                        *phase, None,
                        "legacy display phase must not become provider phase"
                    );
                    for part in content {
                        if let ContentPart::Text(text) = part {
                            items.push(format!("text:{text}"));
                        }
                    }
                    for call in tool_calls {
                        let index = aliases.len();
                        aliases.insert(call.call_id.clone(), index);
                        items.push(format!("call:{index}:{}:{}", call.name, call.arguments));
                    }
                }
                ModelMessage::ToolResult {
                    call_id, content, ..
                } => items.push(format!("result:{}:{content}", aliases[call_id])),
                _ => {}
            }
        }
        items
    };
    assert_eq!(flatten(&replay), flatten(&result.messages));
}
