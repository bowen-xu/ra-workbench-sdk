use super::*;
use std::time::Duration;

struct PendingTail {
    events: VecDeque<ModelStreamEvent>,
}
impl ModelStream for PendingTail {
    fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
        Box::pin(async move {
            match self.events.pop_front() {
                Some(event) => Ok(Some(event)),
                None => std::future::pending().await,
            }
        })
    }
}
struct PendingTransport {
    events: Mutex<Option<Vec<ModelStreamEvent>>>,
    requests: AtomicUsize,
}
impl ModelTransport for PendingTransport {
    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities {
            vision: false,
            tools: true,
            parallel_tools: false,
            reasoning_efforts: vec![],
        }
    }
    fn start(&self, _: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
        Box::pin(async move {
            self.requests.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(PendingTail {
                events: self
                    .events
                    .lock()
                    .unwrap()
                    .take()
                    .expect("Unknown must not sample again")
                    .into(),
            }) as Box<dyn ModelStream>)
        })
    }
}
struct DiagnosticOwner {
    diagnostic: ToolOutcomeDiagnostic,
    starts: Mutex<Vec<String>>,
}
impl ToolExecutor for DiagnosticOwner {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            self.starts.lock().unwrap().push(call.call_id);
            Err(RunError::ToolOutcomeUnknownDiagnostic(Box::new(
                self.diagnostic.clone(),
            )))
        })
    }
    fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
        panic!("an unknown effect cannot have an acknowledged ToolResult")
    }
}
struct Recording<'a> {
    sink: &'a Sink,
    events: Mutex<Vec<AgentEvent>>,
}
impl TurnEventSink for Recording<'_> {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            let event = AgentEvent::new(
                ConversationId::from_uuid(Uuid::from_u128(1)),
                self.sink.projection.lock().unwrap().seq() + 1,
                0,
                Uuid::from_u128(4),
                payload.clone(),
            )
            .unwrap();
            self.sink.emit(payload).await?;
            self.events.lock().unwrap().push(event);
            Ok(())
        })
    }
}

async fn run_unknown(detail: serde_json::Value) -> String {
    let (_, sink, ids, request) = setup(vec![]);
    let call_id = detail["callId"].as_str().unwrap();
    let mut events = vec![begin()];
    events.extend(call(call_id, "{}"));
    // The provider does not finish this response. The queue must notice the
    // unknown owner without awaiting another frame or losing its diagnostic.
    let transport = PendingTransport {
        events: Mutex::new(Some(events)),
        requests: AtomicUsize::new(0),
    };
    let tools = DiagnosticOwner {
        diagnostic: ToolOutcomeDiagnostic::try_from_value(detail.clone()).unwrap(),
        starts: Mutex::new(vec![]),
    };
    let journal = Recording {
        sink: &sink,
        events: Mutex::new(vec![
            AgentEvent::new(
                ConversationId::from_uuid(Uuid::from_u128(1)),
                1,
                0,
                Uuid::from_u128(4),
                EventPayload::TurnStarted {
                    task_kind: TaskKind::Regular,
                    turn_id: Uuid::from_u128(2),
                    context_snapshot_id: Uuid::from_u128(3),
                    model: model(),
                },
            )
            .unwrap(),
        ]),
    };
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &journal,
            ids: &ids,
            limits: limits(),
        }
        .run(Uuid::from_u128(2), request),
    )
    .await
    .expect("unknown owner must stop a pending provider read");
    let Err(error) = result else {
        panic!("unknown effect cannot finish normally")
    };
    let RunError::ToolOutcomeUnknownDiagnostic(ref observed) = error else {
        panic!("queue must retain the closed safe payload")
    };
    assert_eq!(serde_json::to_value(observed).unwrap(), detail);
    assert_eq!(error.failure_category(), FailureCategory::Recovery);
    assert_eq!(*tools.starts.lock().unwrap(), [call_id]);
    assert_eq!(transport.requests.load(Ordering::SeqCst), 1);
    let expected = error.to_string();
    assert!(expected.len() <= 1024);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(
        turn.failure,
        Some((expected.clone(), FailureCategory::Recovery))
    );
    assert_eq!(turn.outcome, Some(TurnOutcome::Failed));
    assert!(
        !turn
            .items
            .values()
            .any(|item| matches!(item.kind, ItemKind::ToolResult { .. }))
    );
    assert!(projection.has_unknown_tool_outcome());
    assert!(matches!(
        reconstruct_history(&projection),
        Err(HistoryError::ToolOutcomeUnknown)
    ));
    let encoded = serde_json::to_string(&*journal.events.lock().unwrap()).unwrap();
    drop(projection);
    let recorded: Vec<AgentEvent> = serde_json::from_str(&encoded).unwrap();
    let mut replay = ConversationProjection::new(ConversationId::from_uuid(Uuid::from_u128(1)));
    for event in recorded {
        replay.apply(&event).unwrap();
    }
    assert_eq!(
        replay.turn(Uuid::from_u128(2)).unwrap().failure,
        Some((expected.clone(), FailureCategory::Recovery))
    );
    assert!(matches!(
        reconstruct_history(&replay),
        Err(HistoryError::ToolOutcomeUnknown)
    ));
    expected
}

#[tokio::test]
async fn detailed_unknown_early_exit_persists_safe_cause_without_a_tool_result_or_resampling() {
    let detail = json!({"code":"TEXT_PATCH_JOURNAL_UNCONFIRMED","phase":"target-terminal",
        "safeCause":"journal_sql_failed","conversationId":Uuid::from_u128(1),"requestId":Uuid::from_u128(5),
        "callId":"original-call","callRequestId":format!("{}:original-call",Uuid::from_u128(5)),
        "targetRequestId":format!("{}:original-call:file:0",Uuid::from_u128(5)),
        "sqliteCode":"ConstraintViolation","sqliteExtendedCode":1811});
    let error = run_unknown(detail.clone()).await;
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(
            error.strip_prefix("tool_outcome_unknown: ").unwrap()
        )
        .unwrap(),
        detail
    );
}

#[tokio::test]
async fn child_archive_intent_survives_terminal_history_replay() {
    let detail = json!({"code":"CHILD_CLEANUP_UNCONFIRMED","phase":"child-cleanup",
        "safeCause":"child_archive_unconfirmed","conversationId":Uuid::from_u128(1),
        "requestId":Uuid::from_u128(4),"resultId":Uuid::from_u128(5),
        "childArchiveIntentVersion":1,"childArchiveOperationId":Uuid::from_u128(6),
        "childArchiveExpectedWatermark":2,"callId":"child-cleanup-call"});
    let error = run_unknown(detail.clone()).await;
    let recorded: serde_json::Value =
        serde_json::from_str(error.strip_prefix("tool_outcome_unknown: ").unwrap()).unwrap();
    assert_eq!(recorded, detail);
}

#[tokio::test]
async fn child_tracking_identity_survives_terminal_history_replay() {
    let detail = json!({"code":"CHILD_TRACKING_UNCONFIRMED","phase":"child-tracking",
        "safeCause":"child_cancellation_unconfirmed","conversationId":Uuid::from_u128(1),
        "turnId":Uuid::from_u128(2),"contextSnapshotId":Uuid::from_u128(3),
        "requestId":Uuid::from_u128(4),"childConversationId":Uuid::from_u128(5),
        "childTurnId":Uuid::from_u128(6),"childContextSnapshotId":Uuid::from_u128(7),
        "callId":"child-call"});
    let error = run_unknown(detail.clone()).await;
    let recorded: serde_json::Value =
        serde_json::from_str(error.strip_prefix("tool_outcome_unknown: ").unwrap()).unwrap();
    assert_eq!(recorded, detail);
}

#[tokio::test]
async fn longest_safe_unknown_still_commits_a_recovery_terminal_without_resampling() {
    let call_id = "c".repeat(MAX_EVENT_NAME_CHARS);
    let scoped = format!("{}:{call_id}:file:127", Uuid::from_u128(5));
    let detail = json!({"code":"C".repeat(101),"phase":"p".repeat(101),"safeCause":"s".repeat(101),
        "conversationId":Uuid::from_u128(1),"requestId":Uuid::from_u128(5),"turnId":Uuid::from_u128(2),
        "contextSnapshotId":Uuid::from_u128(3),"manuscriptId":Uuid::from_u128(6),
        "leaseId":Uuid::from_u128(7),"resultId":Uuid::from_u128(8),
        "callId":call_id,"callRequestId":scoped,"targetRequestId":scoped,"journalRequestId":scoped,
        "sqliteCode":"q".repeat(101),"sqliteExtendedCode":i32::MAX});
    let error = run_unknown(detail.clone()).await;
    let summary: serde_json::Value =
        serde_json::from_str(error.strip_prefix("tool_outcome_unknown: ").unwrap()).unwrap();
    assert_eq!(summary["identifiersOmitted"], true);
    for (key, value) in detail.as_object().unwrap() {
        if [
            "callId",
            "targetRequestId",
            "callRequestId",
            "journalRequestId",
        ]
        .contains(&key.as_str())
        {
            assert!(summary.get(key).is_none());
        } else {
            assert_eq!(&summary[key], value);
        }
    }
}

#[tokio::test]
async fn concurrent_unknown_outcomes_retain_available_recovery_diagnostic() {
    struct MixedOwner {
        barrier: tokio::sync::Barrier,
        detail: ToolOutcomeDiagnostic,
    }
    impl ToolExecutor for MixedOwner {
        fn supports_parallel(&self, _: &ToolCall) -> bool {
            true
        }
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
            Box::pin(async move {
                self.barrier.wait().await;
                if call.call_id == "generic" {
                    Err(RunError::ToolOutcomeUnknown)
                } else {
                    Err(RunError::ToolOutcomeUnknownDiagnostic(Box::new(
                        self.detail.clone(),
                    )))
                }
            })
        }
        fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
            panic!("unknown effects have no acknowledged result")
        }
    }
    let (_, sink, ids, request) = setup(vec![]);
    let mut events = vec![begin()];
    events.extend(call("generic", "{}"));
    events.extend(call("detailed", "{}"));
    let transport = PendingTransport {
        events: Mutex::new(Some(events)),
        requests: AtomicUsize::new(0),
    };
    let detail = ToolOutcomeDiagnostic::try_from_value(json!({
        "code":"TEXT_PATCH_JOURNAL_UNCONFIRMED", "phase":"target-terminal",
        "safeCause":"journal_sql_failed", "callId":"detailed"
    }))
    .unwrap();
    let tools = MixedOwner {
        barrier: tokio::sync::Barrier::new(2),
        detail: detail.clone(),
    };
    let result = tokio::time::timeout(
        Duration::from_secs(2),
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
    let Err(RunError::ToolOutcomeUnknownDiagnostic(observed)) = result else {
        panic!("the detailed recovery cause must survive another unknown result");
    };
    assert_eq!(
        serde_json::to_value(&*observed).unwrap(),
        serde_json::to_value(&detail).unwrap()
    );
    assert_eq!(transport.requests.load(Ordering::SeqCst), 1);
    let projection = sink.projection.lock().unwrap();
    assert!(projection.has_unknown_tool_outcome());
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.failure.as_ref().unwrap().1, FailureCategory::Recovery);
    assert!(
        turn.failure
            .as_ref()
            .unwrap()
            .0
            .contains("journal_sql_failed")
    );
    assert!(
        !turn
            .items
            .values()
            .any(|item| matches!(item.kind, ItemKind::ToolResult { .. }))
    );
}
