use super::*;

#[tokio::test]
async fn stream_cancellation_does_not_start_waiting_tools() {
    struct CancelStream(GatedStream);
    impl ModelStream for CancelStream {
        fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
            Box::pin(async move {
                match self.0.next().await? {
                    Some(event) => Ok(Some(event)),
                    None => Err(ModelError::Canceled),
                }
            })
        }
    }
    struct CancelTransport {
        state: Arc<GateState>,
        events: Mutex<Option<Vec<ModelStreamEvent>>>,
    }
    impl ModelTransport for CancelTransport {
        fn capabilities(&self) -> ModelCapabilities {
            ModelCapabilities {
                vision: true,
                tools: true,
                parallel_tools: true,
                reasoning_efforts: vec![],
            }
        }
        fn start(&self, _: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
            Box::pin(async move {
                Ok(Box::new(CancelStream(GatedStream {
                    state: self.state.clone(),
                    events: self.events.lock().unwrap().take().unwrap().into(),
                    gate: false,
                    gate_target: 0,
                })) as Box<dyn ModelStream>)
            })
        }
    }
    let (_, sink, ids, request) = setup(vec![]);
    let mut events = vec![begin()];
    for (id, args) in [
        ("read-a", "{\"parallel\":true,\"pair\":true}"),
        ("read-b", "{\"parallel\":true,\"pair\":true}"),
        ("exclusive", "{}"),
    ] {
        events.extend(call(id, args));
    }
    let state = Arc::new(GateState::new());
    state.wait_for_stream_close.store(true, Ordering::SeqCst);
    let tools = GateTools {
        state: state.clone(),
        sink: &sink,
    };
    let transport = CancelTransport {
        state: state.clone(),
        events: Mutex::new(Some(events)),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run(Uuid::from_u128(2), request),
    )
    .await
    .expect("started owners must drain");
    assert!(matches!(result, Err(RunError::Model(ModelError::Canceled))));
    assert_eq!(state.finished.load(Ordering::SeqCst), 2);
    assert_eq!(*state.receipts.lock().unwrap(), ["read-a", "read-b"]);
    assert!(
        !state
            .trace
            .lock()
            .unwrap()
            .iter()
            .any(|entry| entry == "start:exclusive")
    );
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.outcome, Some(TurnOutcome::Canceled));
    assert!(turn.items.values().any(|item| item.completed
        && item.text.contains("tool_not_started")
        && matches!(
            item.kind,
            ItemKind::ToolResult {
                is_error: Some(true),
                ..
            }
        )));
}

#[tokio::test]
async fn failed_interleaving_marker_never_starts_model_or_tools() {
    struct MarkerFailure<'a>(&'a Sink);
    impl TurnEventSink for MarkerFailure<'_> {
        fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
            Box::pin(async move {
                if matches!(payload, EventPayload::ModelOutputInterleavingStarted { .. }) {
                    return Err(RunError::EventSink);
                }
                self.0.emit(payload).await
            })
        }
    }
    let (transport, sink, ids, request) = setup(vec![tool_response()]);
    let state = Arc::new(GateState::new());
    let tools = GateTools {
        state: state.clone(),
        sink: &sink,
    };
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &MarkerFailure(&sink),
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::EventSink)));
    assert!(transport.requests.lock().unwrap().is_empty());
    assert!(state.trace.lock().unwrap().is_empty());
}
#[tokio::test]
async fn in_stream_receipt_failure_never_starts_a_conflicting_successor() {
    let (_, sink, ids, request) = setup(vec![]);
    let mut events = vec![begin()];
    for (id, args) in [
        ("read-a", "{\"parallel\":true,\"pair\":true}"),
        ("read-b", "{\"parallel\":true,\"pair\":true}"),
        ("exclusive", "{}"),
        ("read-c", "{\"parallel\":true}"),
    ] {
        events.extend(call(id, args));
    }
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: Some(true),
    });
    let state = Arc::new(GateState::new());
    state.reject_receipt.store(true, Ordering::SeqCst);
    let tools = GateTools {
        state: state.clone(),
        sink: &sink,
    };
    let transport = GatedTransport {
        state: state.clone(),
        responses: Mutex::new([events, answer()].into()),
        requests: Mutex::new(vec![]),
        gate_target: 2,
    };
    let runner = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runner.run(Uuid::from_u128(2), request),
    )
    .await
    .unwrap();
    assert!(matches!(result, Err(RunError::EventSink)));
    assert_eq!(state.finished.load(Ordering::SeqCst), 2);
    assert!(state.receipts.lock().unwrap().is_empty());
    assert!(
        !state
            .trace
            .lock()
            .unwrap()
            .iter()
            .any(|entry| entry == "start:exclusive" || entry == "start:read-c")
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn in_stream_receipt_diagnostic_keeps_persistence_barrier_and_original_detail() {
    let (_, sink, ids, request) = setup(vec![]);
    let mut events = vec![begin()];
    for (id, args) in [
        ("read-a", "{\"parallel\":true,\"pair\":true}"),
        ("read-b", "{\"parallel\":true,\"pair\":true}"),
        ("exclusive", "{}"),
    ] {
        events.extend(call(id, args));
    }
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let state = Arc::new(GateState::new());
    state.diagnostic_receipt.store(true, Ordering::SeqCst);
    let tools = GateTools {
        state: state.clone(),
        sink: &sink,
    };
    let transport = GatedTransport {
        state: state.clone(),
        responses: Mutex::new([events, answer()].into()),
        requests: Mutex::new(vec![]),
        gate_target: 2,
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run(Uuid::from_u128(2), request),
    )
    .await
    .unwrap();
    let Err(RunError::EventSinkDiagnostic(detail)) = result else {
        panic!("original receipt diagnostic must survive teardown");
    };
    let value = serde_json::to_value(detail).unwrap();
    assert_eq!(value["safeCause"], "owner_ack_failed");
    assert_eq!(value["callId"], "read-a");
    assert_eq!(state.finished.load(Ordering::SeqCst), 2);
    assert!(state.receipts.lock().unwrap().is_empty());
    assert!(
        !state
            .trace
            .lock()
            .unwrap()
            .iter()
            .any(|entry| entry == "start:exclusive")
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert!(
        turn.outcome.is_none(),
        "receipt failure cannot publish a terminal result"
    );
}

#[tokio::test]
async fn in_stream_cancellation_drains_started_work_without_starting_waiting_effects() {
    let (_, sink, ids, request) = setup(vec![]);
    let mut events = vec![begin()];
    for (id, args) in [
        ("read-a", "{\"parallel\":true,\"pair\":true}"),
        ("read-b", "{\"parallel\":true,\"pair\":true}"),
        ("exclusive", "{}"),
        ("read-c", "{\"parallel\":true}"),
    ] {
        events.extend(call(id, args));
    }
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: Some(true),
    });
    let state = Arc::new(GateState::new());
    state.cancel_first.store(true, Ordering::SeqCst);
    let tools = GateTools {
        state: state.clone(),
        sink: &sink,
    };
    let transport = GatedTransport {
        state: state.clone(),
        responses: Mutex::new([events, answer()].into()),
        requests: Mutex::new(vec![]),
        gate_target: 2,
    };
    let runner = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runner.run(Uuid::from_u128(2), request),
    )
    .await
    .unwrap();
    assert!(matches!(result, Err(RunError::Model(ModelError::Canceled))));
    assert_eq!(state.finished.load(Ordering::SeqCst), 2);
    assert_eq!(*state.receipts.lock().unwrap(), ["read-b"]);
    assert!(
        !state
            .trace
            .lock()
            .unwrap()
            .iter()
            .any(|entry| entry == "start:exclusive" || entry == "start:read-c")
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn later_parallel_cancellation_closes_stream_before_waiting_for_earlier_owner() {
    let (_, sink, ids, request) = setup(vec![]);
    let mut events = vec![begin()];
    for (id, args) in [
        ("read-a", "{\"parallel\":true,\"pair\":true}"),
        ("read-b", "{\"parallel\":true,\"pair\":true}"),
        ("exclusive", "{}"),
    ] {
        events.extend(call(id, args));
    }
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let state = Arc::new(GateState::new());
    state.cancel_second.store(true, Ordering::SeqCst);
    let tools = GateTools {
        state: state.clone(),
        sink: &sink,
    };
    let transport = GatedTransport {
        state: state.clone(),
        responses: Mutex::new([events, answer()].into()),
        requests: Mutex::new(vec![]),
        gate_target: 2,
    };
    let runner = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runner.run(Uuid::from_u128(2), request),
    )
    .await
    .expect("a later cancellation must release the stream before draining earlier work");
    assert!(matches!(result, Err(RunError::Model(ModelError::Canceled))));
    assert!(state.stream_closed.load(Ordering::SeqCst));
    assert_eq!(state.finished.load(Ordering::SeqCst), 2);
    assert_eq!(*state.receipts.lock().unwrap(), ["read-a"]);
    assert!(
        !state
            .trace
            .lock()
            .unwrap()
            .iter()
            .any(|entry| entry == "start:exclusive")
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.outcome, Some(TurnOutcome::Canceled));
    assert!(turn.items.values().any(|item| item.completed
        && item.text.contains("tool_canceled")
        && matches!(
            item.kind,
            ItemKind::ToolResult {
                is_error: Some(true),
                ..
            }
        )));
}

#[tokio::test]
async fn in_stream_unknown_outcome_drains_started_work_and_blocks_conflicting_successor() {
    let (_, sink, ids, request) = setup(vec![]);
    let mut events = vec![begin()];
    for (id, args) in [
        ("read-a", "{\"parallel\":true,\"pair\":true}"),
        ("read-b", "{\"parallel\":true,\"pair\":true}"),
        ("exclusive", "{}"),
        ("read-c", "{\"parallel\":true}"),
    ] {
        events.extend(call(id, args));
    }
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let state = Arc::new(GateState::new());
    state.unknown_second.store(true, Ordering::SeqCst);
    let tools = GateTools {
        state: state.clone(),
        sink: &sink,
    };
    let transport = GatedTransport {
        state: state.clone(),
        responses: Mutex::new([events, answer()].into()),
        requests: Mutex::new(vec![]),
        gate_target: 2,
    };
    let runner = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runner.run(Uuid::from_u128(2), request),
    )
    .await
    .unwrap();
    assert!(matches!(result, Err(RunError::ToolOutcomeUnknown)));
    assert!(state.stream_closed.load(Ordering::SeqCst));
    assert_eq!(state.finished.load(Ordering::SeqCst), 2);
    assert_eq!(*state.receipts.lock().unwrap(), ["read-a"]);
    assert!(
        !state
            .trace
            .lock()
            .unwrap()
            .iter()
            .any(|entry| entry == "start:exclusive" || entry == "start:read-c")
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let trace = state.trace.lock().unwrap();
    let unknown_end = trace
        .iter()
        .position(|entry| entry == "end:read-b")
        .unwrap();
    let other_end = trace
        .iter()
        .position(|entry| entry == "end:read-a")
        .unwrap();
    assert!(unknown_end < other_end);
    drop(trace);
    let projection = sink.projection.lock().unwrap();
    assert!(projection.has_unknown_tool_outcome());
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert!(
        turn.attempts
            .values()
            .all(|attempt| attempt.outcome != Some(TurnOutcome::Completed))
    );
    assert!(turn.items.values().any(|item| item.completed
        && matches!(&item.kind,
        ItemKind::ToolCall { provider_call_id: Some(id), .. } if id == "exclusive")));
    let exclusive_id = turn
        .items
        .values()
        .find_map(|item| match &item.kind {
            ItemKind::ToolCall {
                call_id,
                provider_call_id: Some(id),
                ..
            } if id == "exclusive" => Some(*call_id),
            _ => None,
        })
        .unwrap();
    assert!(turn.items.values().any(|item| item.completed && item.text.contains("tool_not_started")
        && matches!(&item.kind, ItemKind::ToolResult { call_id, is_error: Some(true) } if *call_id == exclusive_id)));
    assert!(!turn.items.values().any(|item| matches!(&item.kind,
        ItemKind::ToolResult { call_id, .. } if turn.items.values().any(|call| matches!(&call.kind,
            ItemKind::ToolCall { call_id: id, provider_call_id: Some(provider), .. } if id == call_id && provider == "read-b")))));
}
