use super::*;

#[tokio::test]
async fn parallel_large_results_preserve_full_facts_and_ordered_receipts() {
    struct LargeParallel<'a> {
        sink: &'a Sink,
        both: Barrier,
        second_done: Notify,
        completed: Mutex<Vec<String>>,
        receipts: Mutex<Vec<String>>,
    }
    impl ToolExecutor for LargeParallel<'_> {
        fn supports_parallel(&self, _: &ToolCall) -> bool {
            true
        }
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
            Box::pin(async move {
                self.both.wait().await;
                if call.call_id == "first" {
                    self.second_done.notified().await;
                }
                self.completed.lock().unwrap().push(call.call_id.clone());
                if call.call_id == "second" {
                    self.second_done.notify_one();
                }
                Ok(ToolOutput {
                    content: format!("{}:{}", call.call_id, "🦀".repeat(80)),
                    is_error: false,
                })
            })
        }
        fn result_committed(&self, call: ToolCall) -> RunFuture<'_, ()> {
            let projection = self.sink.projection.lock().unwrap();
            let expected = format!("{}:{}", call.call_id, "🦀".repeat(80));
            assert!(
                projection
                    .turn(Uuid::from_u128(2))
                    .unwrap()
                    .items
                    .values()
                    .any(|item| item.completed
                        && matches!(item.kind, ItemKind::ToolResult { .. })
                        && item.text == expected)
            );
            self.receipts.lock().unwrap().push(call.call_id);
            Box::pin(async { Ok(()) })
        }
    }
    let mut events = vec![begin()];
    events.extend(call("first", "{}"));
    events.extend(call("second", "{}"));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let (transport, sink, ids, request) = setup(vec![events, answer()]);
    let tools = LargeParallel {
        sink: &sink,
        both: Barrier::new(2),
        second_done: Notify::new(),
        completed: Mutex::new(vec![]),
        receipts: Mutex::new(vec![]),
    };
    let mut limits = limits();
    limits.tool_output_bytes = 64;
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits,
        }
        .run(Uuid::from_u128(2), request),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(*tools.completed.lock().unwrap(), ["second", "first"]);
    assert_eq!(*tools.receipts.lock().unwrap(), ["first", "second"]);
    let requests = transport.requests.lock().unwrap();
    let views: Vec<_> = requests[1]
        .messages
        .iter()
        .filter_map(|message| match message {
            ModelMessage::ToolResult {
                call_id, content, ..
            } => Some((call_id.as_str(), content.as_str())),
            _ => None,
        })
        .collect();
    assert_eq!(
        views.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        ["first", "second"]
    );
    assert!(
        views
            .iter()
            .all(|(_, text)| text.len() <= 64 && text.contains("chars truncated"))
    );
    assert!(views[0].1.starts_with("first:") && views[1].1.starts_with("second:"));
    assert!(!sink.projection.lock().unwrap().has_unknown_tool_outcome());
}

#[tokio::test]
async fn tools_advance_during_pending_stream_read_with_fair_shared_exclusive_gate() {
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
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runner.run(Uuid::from_u128(2), request),
    )
    .await
    .expect("tool futures must progress while the model read is pending")
    .unwrap();
    assert_eq!(state.peak.load(Ordering::SeqCst), 2);
    let trace = state.trace.lock().unwrap();
    let pos = |entry: &str| trace.iter().position(|actual| actual == entry).unwrap();
    assert!(pos("start:exclusive") > pos("end:read-a"));
    assert!(pos("start:exclusive") > pos("end:read-b"));
    assert!(pos("start:read-c") > pos("end:exclusive"));
    assert_eq!(
        *state.receipts.lock().unwrap(),
        ["read-a", "read-b", "exclusive", "read-c"]
    );
    assert_eq!(state.abandoned_reads.load(Ordering::SeqCst), 0);
    let requests = transport.requests.lock().unwrap();
    let results: Vec<_> = requests[1]
        .messages
        .iter()
        .filter_map(|message| match message {
            ModelMessage::ToolResult { call_id, .. } => Some(call_id.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(results, ["read-a", "read-b", "exclusive", "read-c"]);
}
