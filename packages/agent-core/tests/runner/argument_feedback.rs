use super::*;

struct ArgumentTools {
    executions: AtomicUsize,
    receipts: AtomicUsize,
}
impl ToolExecutor for ArgumentTools {
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        if !call.arguments.is_object() {
            return Err(RunError::ToolArguments(
                "This read tool requires an object.".into(),
            ));
        }
        if call.arguments.get("deny") == Some(&json!(true)) {
            return Err(RunError::ToolRejected);
        }
        if call.arguments.get("maxChars") == Some(&json!(13500)) {
            return Err(RunError::ToolArguments(
                "maxChars must be 1–8000; use nextChar for the next page.".into(),
            ));
        }
        Ok(())
    }
    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.executions.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(ToolOutput {
                content: "body".into(),
                is_error: false,
            })
        })
    }
    fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
        self.receipts.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test]
async fn raw_parameter_errors_are_accepted_then_paired_before_the_model_corrects_them() {
    for raw in ["{", "", "[1]", "null", "7", "\"text\""] {
        let (transport, sink, ids, request) = setup(vec![
            response(&[("prior", "{}"), ("bad", raw)]),
            response(&[("corrected", "{}")]),
            answer(),
        ]);
        let base = ArgumentTools {
            executions: AtomicUsize::new(0),
            receipts: AtomicUsize::new(0),
        };
        let tools = ObservedTools {
            base: &base,
            sink: &sink,
            calls: Mutex::new(vec![]),
            receipts: Mutex::new(vec![]),
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
        assert_eq!(base.executions.load(Ordering::SeqCst), 2);
        assert_eq!(base.receipts.load(Ordering::SeqCst), 2);
        assert_eq!(*tools.calls.lock().unwrap(), ["prior", "corrected"]);
        assert_eq!(*tools.receipts.lock().unwrap(), ["prior", "corrected"]);
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests[1].messages.iter().any(
            |message| matches!(message,ModelMessage::CanonicalOutput(item)
            if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call))
                if call.call_id=="bad" && call.raw_arguments_json==raw))
        ));
        assert!(requests[1].messages.iter().any(
            |message| matches!(message,ModelMessage::ToolResult {call_id, content, is_error:true}
            if call_id=="bad" && content.contains("invalid_tool_arguments"))
        ));
        for request in requests.iter() {
            request.validate(transport.capabilities()).unwrap();
        }
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert!(
            turn.items
                .values()
                .any(|item| matches!(item.kind, ItemKind::ToolCall { .. })
                    && item.accepted
                    && item.text == raw)
        );
        let replay = reconstruct_history(&projection).unwrap();
        assert!(replay.iter().any(|message|matches!(message,ModelMessage::CanonicalOutput(item)
            if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call))if call.raw_arguments_json==raw))));
        assert!(result.messages.len() > 4);
    }
}

struct ObservedTools<'a> {
    base: &'a ArgumentTools,
    sink: &'a Sink,
    calls: Mutex<Vec<String>>,
    receipts: Mutex<Vec<String>>,
}

#[tokio::test]
async fn an_array_capable_target_can_execute_valid_non_object_json() {
    struct ArrayTools(AtomicUsize);
    impl ToolExecutor for ArrayTools {
        fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
            if call.arguments.is_array() {
                Ok(())
            } else {
                Err(RunError::ToolArguments("Provide an array.".into()))
            }
        }
        fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.validate(&call).unwrap();
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ToolOutput {
                    content: "array accepted".into(),
                    is_error: false,
                })
            })
        }
    }
    let (transport, sink, ids, mut request) = setup(vec![response(&[("array", "[1]")]), answer()]);
    request.tools[0].parameters = json!({"type":"array","items":{"type":"integer"}});
    let tools = ArrayTools(AtomicUsize::new(0));
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
    assert_eq!(tools.0.load(Ordering::SeqCst), 1);
    assert!(matches!(&transport.requests.lock().unwrap()[1].messages[2],
        ModelMessage::ToolResult {is_error:false,content,..}if content=="array accepted"));
}
impl ToolExecutor for ObservedTools<'_> {
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        let projection = self.sink.projection.lock().unwrap();
        assert!(projection.turn(Uuid::from_u128(2)).unwrap().items.values().any(|item|
            item.accepted && item.completed && matches!(&item.kind,ItemKind::ToolCall {provider_call_id:Some(id),..} if id==&call.call_id)));
        self.base.validate(call)
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.calls.lock().unwrap().push(call.call_id.clone());
        self.base.authorize_and_execute(call)
    }
    fn result_committed(&self, call: ToolCall) -> RunFuture<'_, ()> {
        self.receipts.lock().unwrap().push(call.call_id.clone());
        self.base.result_committed(call)
    }
}
fn response(calls: &[(&str, &str)]) -> Vec<ModelStreamEvent> {
    let mut events = vec![begin()];
    for (id, args) in calls {
        events.extend(call(id, args));
    }
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    events
}

#[tokio::test]
async fn invalid_arguments_are_durable_feedback_then_corrected_without_executing_invalid_call() {
    let (transport, sink, ids, request) = setup(vec![
        response(&[("oversize", "{\"maxChars\":13500}")]),
        response(&[("corrected", "{\"maxChars\":8000}")]),
        answer(),
    ]);
    let tools = ArgumentTools {
        executions: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
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
    assert_eq!(tools.executions.load(Ordering::SeqCst), 1);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 1);
    assert!(result.messages.iter().any(|message| matches!(message,
        ModelMessage::ToolResult { call_id, content, is_error: true }
        if call_id == "oversize" && content.contains("8000") && content.contains("nextChar"))));
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
    assert!(
        turn.items
            .values()
            .any(|item| item.text == "answer" && item.completed)
    );
}

#[tokio::test]
async fn fatal_later_validation_retains_accepted_calls_and_feedback() {
    let (transport, sink, ids, request) = setup(vec![response(&[
        ("valid", "{}"),
        ("oversize", "{\"maxChars\":13500}"),
        ("denied", "{\"deny\":true}"),
    ])]);
    let tools = ArgumentTools {
        executions: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
    };
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::ToolRejectionDiagnostic(_))));
    assert_eq!(tools.executions.load(Ordering::SeqCst), 1);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 1);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.outcome, Some(TurnOutcome::Failed));
    let (error, category) = turn.failure.as_ref().unwrap();
    assert_eq!(*category, FailureCategory::ToolRound);
    let diagnostic: serde_json::Value =
        serde_json::from_str(error.strip_prefix("tool request rejected: ").unwrap()).unwrap();
    assert_eq!(diagnostic["code"], "executor_validation_rejected");
    assert_eq!(diagnostic["providerCallId"], "denied");
    assert_eq!(diagnostic["batchIndex"], 2);
    assert!(
        diagnostic.get("batchSize").is_none(),
        "later items are not known at item.done"
    );
    assert_eq!(diagnostic["advertised"], true);
    assert!(!error.contains("deny"));
    let denied = turn.items.values().find(|item|matches!(&item.kind,ItemKind::ToolCall {provider_call_id:Some(id),..}if id=="denied")).unwrap();
    assert!(denied.accepted && denied.completed);
    let ItemKind::ToolCall { call_id, .. } = denied.kind else {
        unreachable!()
    };
    assert!(turn.items.values().any(|item|matches!(item.kind,ItemKind::ToolResult {call_id:id,is_error:Some(true)}if id==call_id)
        && item.completed && item.text.contains("tool_not_started")));
    assert!(
        reconstruct_history(&projection).is_ok(),
        "rejected unstarted work has an explicit result"
    );
}

#[tokio::test]
async fn duplicate_call_keeps_a_durable_diagnostic_without_starting_the_batch() {
    let (transport, sink, ids, request) = setup(vec![
        response(&[("reused", "{}")]),
        response(&[("reused", "{\"privateBody\":\"never copy this\"}")]),
    ]);
    let tools = ArgumentTools {
        executions: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
    };
    let error = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .err()
    .expect("reused call must fail")
    .to_string();
    assert!(error.contains("duplicate_call_id"));
    assert!(error.contains("reused"));
    assert!(!error.contains("privateBody"));
    assert!(!error.contains("never copy this"));
    assert_eq!(tools.executions.load(Ordering::SeqCst), 1);
    let projection = sink.projection.lock().unwrap();
    assert_eq!(
        projection
            .turn(Uuid::from_u128(2))
            .unwrap()
            .failure
            .as_ref()
            .unwrap()
            .0,
        error
    );
}

#[tokio::test]
async fn repeated_argument_errors_stop_at_the_existing_budget_with_a_durable_reason() {
    let (transport, sink, ids, request) = setup(vec![
        response(&[("first", "{\"maxChars\":13500}")]),
        response(&[("second", "{\"maxChars\":13500}")]),
        response(&[("third", "{\"maxChars\":13500}")]),
    ]);
    let tools = ArgumentTools {
        executions: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
    };
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::Budget)));
    assert_eq!(tools.executions.load(Ordering::SeqCst), 0);
    assert_eq!(
        sink.projection
            .lock()
            .unwrap()
            .turn(Uuid::from_u128(2))
            .unwrap()
            .failure,
        Some(("run budget exhausted".into(), FailureCategory::Admission))
    );
}
