use super::*;
struct ReceiptTools<'a> {
    sink: &'a Sink,
    executions: AtomicUsize,
    receipts: AtomicUsize,
    fail_receipt: bool,
}
impl ToolExecutor for ReceiptTools<'_> {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.executions.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(ToolOutput {
                content: "retained result".into(),
                is_error: false,
            })
        })
    }
    fn result_committed(&self, call: ToolCall) -> RunFuture<'_, ()> {
        Box::pin(async move {
            assert_eq!(call.call_id, "call-1");
            let state = self.sink.projection.lock().unwrap();
            assert!(state.has_unknown_tool_outcome());
            assert!(
                state
                    .turn(Uuid::from_u128(2))
                    .unwrap()
                    .items
                    .values()
                    .any(|item| matches!(item.kind, ItemKind::ToolResult { .. }) && item.completed)
            );
            self.receipts.fetch_add(1, Ordering::SeqCst);
            if self.fail_receipt {
                Err(RunError::ToolRejected)
            } else {
                Ok(())
            }
        })
    }
}
struct ResultFailure<'a>(&'a Sink);
impl TurnEventSink for ResultFailure<'_> {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            if let EventPayload::ItemCompleted { item_id, .. } = &payload {
                let state = self.0.projection.lock().unwrap();
                if state
                    .turn(Uuid::from_u128(2))
                    .unwrap()
                    .items
                    .get(item_id)
                    .is_some_and(|item| matches!(item.kind, ItemKind::ToolResult { .. }))
                {
                    return Err(RunError::EventSink);
                }
            }
            self.0.emit(payload).await
        })
    }
}
#[tokio::test]
async fn receipt_runs_only_after_durable_result_and_before_model_continuation() {
    for fail_receipt in [false, true] {
        let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
        let tools = ReceiptTools {
            sink: &sink,
            executions: AtomicUsize::new(0),
            receipts: AtomicUsize::new(0),
            fail_receipt,
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
        assert_eq!(tools.executions.load(Ordering::SeqCst), 1);
        assert_eq!(tools.receipts.load(Ordering::SeqCst), 1);
        if fail_receipt {
            assert!(matches!(result, Err(RunError::EventSink)));
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
            assert!(sink.projection.lock().unwrap().has_unknown_tool_outcome());
        } else {
            assert!(result.is_ok());
            assert_eq!(transport.requests.lock().unwrap().len(), 2);
            assert!(!sink.projection.lock().unwrap().has_unknown_tool_outcome());
        }
    }
}
#[tokio::test]
async fn failed_result_commit_retains_resources_and_never_reexecutes_tool() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let tools = ReceiptTools {
        sink: &sink,
        executions: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
        fail_receipt: false,
    };
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &ResultFailure(&sink),
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::EventSink)));
    assert_eq!(tools.executions.load(Ordering::SeqCst), 1);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 0);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    assert!(sink.projection.lock().unwrap().has_unknown_tool_outcome());
}

struct ConfirmationFailure<'a>(&'a Sink);
impl TurnEventSink for ConfirmationFailure<'_> {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            if matches!(payload, EventPayload::ToolReceiptConfirmed { .. }) {
                return Err(RunError::EventSink);
            }
            self.0.emit(payload).await
        })
    }
}

struct NoReceiptTools;
impl ToolExecutor for NoReceiptTools {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn requires_result_receipt(&self, _: &ToolCall) -> bool {
        false
    }
    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async {
            Ok(ToolOutput {
                content: "read-only result".into(),
                is_error: false,
            })
        })
    }
    fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
        panic!("a receipt-free owner must not receive an acknowledgement")
    }
}

#[tokio::test]
async fn explicitly_receipt_free_tool_needs_no_confirmation_event_or_owner_callback() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let result = TurnRunner {
        transport: &transport,
        tools: &NoReceiptTools,
        sink: &ConfirmationFailure(&sink),
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(result.is_ok());
    assert_eq!(transport.requests.lock().unwrap().len(), 2);
    assert!(!sink.projection.lock().unwrap().has_unknown_tool_outcome());
}

struct NextRequestFailure<'a>(&'a Sink);
impl TurnEventSink for NextRequestFailure<'_> {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            if matches!(payload, EventPayload::ModelRequestStarted { .. })
                && self
                    .0
                    .projection
                    .lock()
                    .unwrap()
                    .turn(Uuid::from_u128(2))
                    .unwrap()
                    .items
                    .values()
                    .any(|item| item.completed && matches!(item.kind, ItemKind::ToolResult { .. }))
            {
                return Err(RunError::EventSink);
            }
            self.0.emit(payload).await
        })
    }
}

#[tokio::test]
async fn receipt_free_result_survives_interruption_without_a_spurious_recovery_barrier() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let result = TurnRunner {
        transport: &transport,
        tools: &NoReceiptTools,
        sink: &NextRequestFailure(&sink),
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::EventSink)));
    sink.emit(EventPayload::TurnFinished {
        turn_id: Uuid::from_u128(2),
        outcome: TurnOutcome::Interrupted,
    })
    .await
    .unwrap();
    let state = sink.projection.lock().unwrap();
    assert!(!state.has_unknown_tool_outcome());
    assert!(
        state
            .turn(Uuid::from_u128(2))
            .unwrap()
            .items
            .values()
            .any(|item| item.completed && matches!(item.kind, ItemKind::ToolResult { .. }))
    );
}

#[tokio::test]
async fn failed_confirmation_record_keeps_barrier_after_owner_acknowledged() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let tools = ReceiptTools {
        sink: &sink,
        executions: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
        fail_receipt: false,
    };
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &ConfirmationFailure(&sink),
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::EventSink)));
    assert_eq!(tools.executions.load(Ordering::SeqCst), 1);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 1);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    assert!(sink.projection.lock().unwrap().has_unknown_tool_outcome());
}
