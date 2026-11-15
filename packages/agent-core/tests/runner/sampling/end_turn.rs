use super::*;

struct ExplicitContinuationBoundary(Mutex<Vec<bool>>);
impl SamplingContext for ExplicitContinuationBoundary {
    fn prepare(
        &self,
        _: Uuid,
        request: ModelRequest,
        followup: bool,
    ) -> RunFuture<'_, PreparedSamplingContext> {
        Box::pin(async move {
            self.0.lock().unwrap().push(followup);
            Ok(PreparedSamplingContext {
                request,
                compacted: true,
            })
        })
    }
}

#[tokio::test]
async fn explicit_no_tool_followup_after_compaction_precedes_pending_steer() {
    // Codex treats end_turn=false exactly like tools for the post-compact
    // pending-input gate: finish the old model continuation before draining it.
    let mut progress = answer();
    *progress.last_mut().unwrap() = ModelStreamEvent::Completed {
        reason: FinishReason::Stop,
        end_turn: Some(false),
    };
    let (transport, sink, ids, request) = setup(vec![progress, answer(), answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = pending(&sink);
    let boundary = ExplicitContinuationBoundary(Mutex::new(vec![]));
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_sampling_context(
        Uuid::from_u128(2),
        request,
        &input,
        &RetryRecorder(Arc::new(Mutex::new(vec![]))),
        Some(&boundary),
    )
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(!has_steer(&requests[1]));
    assert!(has_steer(&requests[2]));
    assert_eq!(*boundary.0.lock().unwrap(), vec![true, false]);
}

struct FinalizingTools<'a>(Tools<'a>);
impl ToolExecutor for FinalizingTools<'_> {
    fn finalization_call(&self) -> RunFuture<'_, Option<ToolCall>> {
        Box::pin(async {
            Ok(
                (self.0.executed.load(Ordering::SeqCst) == 0).then(|| ToolCall {
                    namespace: None,
                    raw_arguments_json: None,
                    call_id: "host-finalization".into(),
                    name: "read".into(),
                    arguments: json!({}),
                }),
            )
        })
    }
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        self.0.validate(call)
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.0.authorize_and_execute(call)
    }
}

#[tokio::test]
async fn pending_steer_precedes_finalization_then_sealed_tool_followup_can_compact() {
    let (transport, sink, ids, request) = setup(vec![answer(), answer(), answer()]);
    let tools = FinalizingTools(Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    });
    let input = pending(&sink);
    let boundary = ExplicitContinuationBoundary(Mutex::new(vec![]));
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_sampling_context(
        Uuid::from_u128(2),
        request,
        &input,
        &RetryRecorder(Arc::new(Mutex::new(vec![]))),
        Some(&boundary),
    )
    .await
    .unwrap();
    assert!(
        result.responses[0].tool_calls.is_empty(),
        "provider facts must not gain the host-injected call"
    );
    assert_eq!(result.responses[0].end_turn, None);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(has_steer(&requests[1]));
    assert!(has_steer(&requests[2]));
    assert_eq!(*boundary.0.lock().unwrap(), vec![false, true]);
    assert_eq!(tools.0.executed.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn sealed_input_is_not_reopened_while_finalization_correction_continues_sampling() {
    struct Fence(std::sync::atomic::AtomicBool);
    impl TurnInputSource for Fence {
        fn has_pending(&self, _: Uuid) -> RunFuture<'_, bool> {
            Box::pin(async { Ok(false) })
        }
        fn has_pending_or_seal(&self, _: Uuid) -> RunFuture<'_, bool> {
            Box::pin(async {
                assert!(!self.0.swap(true, Ordering::SeqCst), "inspect only once");
                Ok(false)
            })
        }
        fn drain(&self, _: Uuid, _: bool) -> RunFuture<'_, Vec<ModelMessage>> {
            Box::pin(async {
                assert!(!self.0.load(Ordering::SeqCst), "sealed input cannot drain");
                Ok(vec![])
            })
        }
    }
    struct FencedFinalizer<'a> {
        tools: FinalizingTools<'a>,
        fence: &'a Fence,
    }
    impl ToolExecutor for FencedFinalizer<'_> {
        fn finalization_call(&self) -> RunFuture<'_, Option<ToolCall>> {
            assert!(
                self.fence.0.load(Ordering::SeqCst),
                "seal before revoking writes"
            );
            self.tools.finalization_call()
        }
        fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
            self.tools.validate(call)
        }
        fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.tools.authorize_and_execute(call)
        }
    }
    let (transport, sink, ids, request) = setup(vec![answer(), tool_response(), answer()]);
    let input = Fence(std::sync::atomic::AtomicBool::new(false));
    let tools = FencedFinalizer {
        tools: FinalizingTools(Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        }),
        fence: &input,
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
    assert_eq!(transport.requests.lock().unwrap().len(), 3);
    assert_eq!(tools.tools.0.executed.load(Ordering::SeqCst), 2);
}
