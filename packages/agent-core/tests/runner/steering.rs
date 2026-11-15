use super::*;
#[path = "sampling.rs"]
mod sampling;
#[path = "steering/stop_hooks.rs"]
mod stop_hooks;

struct Input<'a> {
    sink: &'a Sink,
    drains: Mutex<VecDeque<Vec<ModelMessage>>>,
    closing: Mutex<Vec<bool>>,
    next_id: AtomicU64,
}
impl TurnInputSource for Input<'_> {
    fn seal_for_stop(&self, _: Uuid) -> RunFuture<'_, ()> {
        Box::pin(async move {
            self.closing.lock().unwrap().push(true);
            Ok(())
        })
    }
    fn has_pending(&self, _: Uuid) -> RunFuture<'_, bool> {
        Box::pin(async move {
            Ok(self
                .drains
                .lock()
                .unwrap()
                .iter()
                .any(|batch| !batch.is_empty()))
        })
    }
    fn has_pending_or_seal(&self, _: Uuid) -> RunFuture<'_, bool> {
        Box::pin(async move {
            self.closing.lock().unwrap().push(true);
            Ok(self
                .drains
                .lock()
                .unwrap()
                .iter()
                .any(|batch| !batch.is_empty()))
        })
    }
    fn drain(&self, turn_id: Uuid, finish_if_empty: bool) -> RunFuture<'_, Vec<ModelMessage>> {
        Box::pin(async move {
            self.closing.lock().unwrap().push(finish_if_empty);
            let messages = self
                .drains
                .lock()
                .unwrap()
                .drain(..)
                .flatten()
                .collect::<Vec<_>>();
            for message in &messages {
                if let ModelMessage::User { content: parts, .. } = message {
                    let item_id =
                        Uuid::from_u128(self.next_id.fetch_add(1, Ordering::SeqCst) as u128);
                    self.sink
                        .emit(EventPayload::ItemStarted {
                            turn_id,
                            item_id,
                            kind: ItemKind::UserMessage,
                        })
                        .await?;
                    for part in parts {
                        if let ContentPart::Text(text) = part {
                            self.sink
                                .emit(EventPayload::TextDelta {
                                    turn_id,
                                    item_id,
                                    text: text.clone(),
                                })
                                .await?;
                        }
                    }
                    self.sink
                        .emit(EventPayload::ItemCompleted { turn_id, item_id })
                        .await?;
                }
            }
            Ok(messages)
        })
    }
}

#[tokio::test]
async fn input_at_answer_boundary_continues_same_turn_before_sealing() {
    let (transport, sink, ids, request) = setup(vec![answer(), answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = Input {
        sink: &sink,
        drains: Mutex::new(VecDeque::from([vec![ModelMessage::User {
            content: vec![ContentPart::Text("clarification".into())],
            source_item_id: None,
        }]])),
        closing: Mutex::new(vec![]),
        next_id: AtomicU64::new(1000),
    };
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_input(Uuid::from_u128(2), request, &input)
    .await
    .unwrap();
    assert_eq!(result.responses.len(), 2);
    assert_eq!(*input.closing.lock().unwrap(), vec![true, false, true]);
    let requests = transport.requests.lock().unwrap();
    assert_ne!(requests[0].request_id, requests[1].request_id);
    assert!(!requests[0].messages.iter().any(|message| matches!(message, ModelMessage::User { content: parts, .. } if parts.iter().any(|part| matches!(part, ContentPart::Text(text) if text == "clarification")))));
    assert!(
        matches!(requests[1].messages.last(), Some(ModelMessage::User { content: parts, source_item_id: None }) if matches!(parts.as_slice(), [ContentPart::Text(text)] if text == "clarification"))
    );
    let projection = sink.projection.lock().unwrap();
    assert!(projection.active_turn().is_none());
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert!(
        turn.items
            .values()
            .any(|item| item.kind == ItemKind::UserMessage && item.completed)
    );
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn steering_cannot_inject_assistant_history() {
    let (transport, sink, ids, request) = setup(vec![answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = Input {
        sink: &sink,
        drains: Mutex::new(VecDeque::from([vec![ModelMessage::Assistant {
            phase: None,
            content: vec![],
            tool_calls: vec![],
        }]])),
        closing: Mutex::new(vec![]),
        next_id: AtomicU64::new(1000),
    };
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_input(Uuid::from_u128(2), request, &input)
    .await;
    assert!(matches!(result, Err(RunError::EventSink)));
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn steering_after_tools_preserves_call_result_order() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = Input {
        sink: &sink,
        drains: Mutex::new(VecDeque::from([vec![ModelMessage::User {
            content: vec![ContentPart::Text("use this evidence".into())],
            source_item_id: None,
        }]])),
        closing: Mutex::new(vec![]),
        next_id: AtomicU64::new(1000),
    };
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_input(Uuid::from_u128(2), request, &input)
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert!(matches!(requests[1].messages.as_slice(), [
        ModelMessage::User { content: _, .. }, ModelMessage::CanonicalOutput(call),
        ModelMessage::ToolResult { call_id, .. }, ModelMessage::User { content: _, .. },
    ] if call_id == "call-1" && matches!(&call.normalized,Some(ModelOutputItem::ToolCall(call)) if call.call_id=="call-1")));
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn multiple_pending_steers_share_the_next_model_request_in_order() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let first = Uuid::from_u128(501);
    let second = Uuid::from_u128(502);
    let input = Input {
        sink: &sink,
        drains: Mutex::new(VecDeque::from([
            vec![ModelMessage::User {
                content: vec![ContentPart::Text("first pending steer".into())],
                source_item_id: Some(first),
            }],
            vec![ModelMessage::User {
                content: vec![ContentPart::Text("second pending steer".into())],
                source_item_id: Some(second),
            }],
        ])),
        closing: Mutex::new(vec![]),
        next_id: AtomicU64::new(1000),
    };
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_input(Uuid::from_u128(2), request, &input)
    .await
    .unwrap();

    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(!requests[0].messages.iter().any(|message| matches!(message,
        ModelMessage::User { source_item_id: Some(id), .. } if *id == first || *id == second)));
    assert!(matches!(requests[1].messages.as_slice(), [
        ModelMessage::User { .. }, ModelMessage::CanonicalOutput(_), ModelMessage::ToolResult { .. },
        ModelMessage::User { content: a, source_item_id: Some(aid) },
        ModelMessage::User { content: b, source_item_id: Some(bid) },
    ] if *aid == first && *bid == second
        && matches!(a.as_slice(), [ContentPart::Text(text)] if text == "first pending steer")
        && matches!(b.as_slice(), [ContentPart::Text(text)] if text == "second pending steer")));
}
