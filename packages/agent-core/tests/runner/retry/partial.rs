use super::*;

fn partial(error: Option<ModelError>) -> Step {
    let mut events = vec![
        Ok(begin()),
        Ok(ModelStreamEvent::TextDelta("failed draft".into())),
    ];
    // Arguments without their item.done remain drafts and cannot execute.
    events.extend(call("not-executable", "{}").into_iter().take(2).map(Ok));
    if let Some(error) = error {
        events.push(Err(error));
    }
    Step::Stream(events)
}

#[tokio::test]
async fn streamed_failure_and_eof_retry_from_completed_tool_history_without_draft_or_reexecution() {
    for error in [
        Some(ModelError::Unavailable),
        Some(ModelError::ServerOverloaded),
        None,
    ] {
        let (_, sink, ids, request) = setup(vec![]);
        let transport = script(vec![
            response(tool_response()),
            partial(error),
            response(answer()),
        ]);
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let waits = Arc::new(Mutex::new(vec![]));
        let result = TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run_with_retry_wait(
            Uuid::from_u128(2),
            request,
            &NoAdditionalInputForTest,
            &RetryRecorder(waits.clone()),
        )
        .await
        .unwrap();
        assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
        assert_eq!(result.responses.len(), 2);
        assert_eq!(*waits.lock().unwrap(), vec![250]);
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests[1].messages == requests[2].messages);
        assert!(
            requests[2]
                .messages
                .iter()
                .any(|m| matches!(m, ModelMessage::ToolResult { .. }))
        );
        assert!(!has_draft(&requests[2].messages));
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
        let draft = turn
            .items
            .values()
            .find(|item| item.text == "failed draft")
            .unwrap();
        assert!(draft.interrupted && !draft.completed);
        assert!(
            turn.items
                .values()
                .any(|item| item.text == "answer" && item.completed)
        );
        let restored = reconstruct_history(&projection).unwrap();
        assert!(!has_draft(&restored));
        assert!(
            restored
                .iter()
                .any(|m| matches!(m, ModelMessage::ToolResult { .. }))
        );
    }
}

#[tokio::test]
async fn partial_failure_exhaustion_keeps_original_error_and_no_synthetic_continuation() {
    for model_calls in [1, 8] {
        let (_, sink, ids, request) = setup(vec![]);
        let original = request.messages.clone();
        let transport = script(
            (0..model_calls)
                .map(|_| partial(Some(ModelError::Unavailable)))
                .collect(),
        );
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let waits = Arc::new(Mutex::new(vec![]));
        let result = TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: RunLimits {
                model_calls: Some(model_calls),
                ..limits()
            },
        }
        .run_with_retry_wait(
            Uuid::from_u128(2),
            request,
            &NoAdditionalInputForTest,
            &RetryRecorder(waits.clone()),
        )
        .await;
        assert!(matches!(
            result,
            Err(RunError::Model(ModelError::Unavailable))
        ));
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), model_calls);
        assert!(waits.lock().unwrap().iter().all(|delay| *delay == 250));
        assert!(requests.iter().all(|r| r.messages == original));
        assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
        assert_eq!(
            sink.projection
                .lock()
                .unwrap()
                .turn(Uuid::from_u128(2))
                .unwrap()
                .outcome,
            Some(TurnOutcome::Failed)
        );
    }
}

fn has_draft(messages: &[ModelMessage]) -> bool {
    messages.iter().any(|message| match message {
        ModelMessage::User {
            content: parts,
            source_item_id: None,
        }
        | ModelMessage::Assistant { content: parts, .. } => parts
            .iter()
            .any(|part| matches!(part, ContentPart::Text(text) if text.contains("failed draft"))),
        _ => false,
    })
}

#[tokio::test]
async fn completed_call_before_stream_failure_is_paired_before_retry_without_reexecution() {
    for error in [ModelError::Unavailable, ModelError::Canceled] {
        let (_, sink, ids, request) = setup(vec![]);
        let mut events = vec![Ok(begin())];
        events.extend(call("accepted-before-failure", "{}").into_iter().map(Ok));
        events.push(Err(error));
        let transport = script(vec![Step::Stream(events), response(answer())]);
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
        .await;
        assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
        let requests = transport.requests.lock().unwrap();
        if error == ModelError::Canceled {
            assert!(matches!(result, Err(RunError::Model(ModelError::Canceled))));
            assert_eq!(requests.len(), 1);
        } else {
            result.unwrap();
            assert_eq!(requests.len(), 2);
            assert!(requests[1].messages.iter().any(|message| matches!(message,
                ModelMessage::ToolResult { call_id, .. } if call_id == "accepted-before-failure")));
        }
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert!(
            turn.items
                .values()
                .any(|item| matches!(item.kind, ItemKind::ToolResult { .. }) && item.completed)
        );
    }
}

#[tokio::test]
async fn committed_tool_before_stream_retry_prepares_its_requested_context_window_first() {
    struct Rollover {
        requested: std::sync::atomic::AtomicBool,
        prepared: AtomicUsize,
    }
    impl SamplingContext for Rollover {
        fn observe_tool_result<'a>(
            &'a self,
            _: Uuid,
            request: &'a ModelRequest,
        ) -> RunFuture<'a, ()> {
            Box::pin(async move {
                assert!(
                    request
                        .messages
                        .iter()
                        .any(|message| matches!(message, ModelMessage::ToolResult { .. }))
                );
                self.requested.store(true, Ordering::SeqCst);
                Ok(())
            })
        }
        fn prepare(
            &self,
            _: Uuid,
            mut request: ModelRequest,
            followup: bool,
        ) -> RunFuture<'_, PreparedSamplingContext> {
            Box::pin(async move {
                assert!(followup);
                assert!(self.requested.swap(false, Ordering::SeqCst));
                self.prepared.fetch_add(1, Ordering::SeqCst);
                request.messages = vec![ModelMessage::User {
                    content: vec![ContentPart::Text("replacement window".into())],
                    source_item_id: None,
                }];
                Ok(PreparedSamplingContext {
                    request,
                    compacted: true,
                })
            })
        }
    }
    let (_, sink, ids, request) = setup(vec![]);
    let mut first = vec![Ok(begin())];
    first.extend(call("request-rollover", "{}").into_iter().map(Ok));
    first.push(Err(ModelError::Unavailable));
    let transport = script(vec![Step::Stream(first), response(answer())]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let context = Rollover {
        requested: std::sync::atomic::AtomicBool::new(false),
        prepared: AtomicUsize::new(0),
    };
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
        &NoAdditionalInputForTest,
        &RetryRecorder(Arc::new(Mutex::new(vec![]))),
        Some(&context),
    )
    .await
    .unwrap();
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
    assert_eq!(context.prepared.load(Ordering::SeqCst), 1);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(
        matches!(requests[1].messages.as_slice(), [ModelMessage::User { content: parts, source_item_id: None }]
        if matches!(parts.as_slice(), [ContentPart::Text(text)] if text == "replacement window"))
    );
}

#[tokio::test]
async fn received_text_resets_backoff_before_the_response_finishes() {
    let (_, sink, ids, request) = setup(vec![]);
    let transport = script(vec![
        failure(ModelError::Unavailable, false),
        failure(ModelError::Unavailable, true),
        partial(Some(ModelError::Unavailable)),
        response(answer()),
    ]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let waits = Arc::new(Mutex::new(vec![]));
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: RunLimits {
            model_calls: Some(4),
            ..limits()
        },
    }
    .run_with_retry_wait(
        Uuid::from_u128(2),
        request,
        &NoAdditionalInputForTest,
        &RetryRecorder(waits.clone()),
    )
    .await
    .unwrap();
    assert_eq!(*waits.lock().unwrap(), vec![250, 500, 250]);
}

#[tokio::test]
async fn exhaustion_does_not_erase_previously_completed_tool_history_on_reopen() {
    let (_, sink, ids, request) = setup(vec![]);
    let transport = script(vec![
        response(tool_response()),
        partial(Some(ModelError::Unavailable)),
        partial(Some(ModelError::Unavailable)),
        partial(Some(ModelError::Unavailable)),
    ]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let waits = Arc::new(Mutex::new(vec![]));
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_retry_wait(
        Uuid::from_u128(2),
        request,
        &NoAdditionalInputForTest,
        &RetryRecorder(waits),
    )
    .await;
    assert!(matches!(
        result,
        Err(RunError::Model(ModelError::Unavailable))
    ));
    let projection = sink.projection.lock().unwrap();
    let restored =
        reconstruct_history_for_continuation(&projection, &std::collections::HashMap::new())
            .unwrap();
    assert!(!has_draft(&restored));
    assert!(
        restored
            .iter()
            .any(|m| matches!(m, ModelMessage::ToolResult { .. }))
    );
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
}
