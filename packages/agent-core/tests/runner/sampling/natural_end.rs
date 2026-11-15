use super::*;

struct EndBoundary<'a> {
    input: &'a Input<'a>,
    sink: &'a Sink,
    completed: AtomicUsize,
    prepared: AtomicUsize,
    fail: Option<ModelError>,
}
impl SamplingContext for EndBoundary<'_> {
    fn prepare(
        &self,
        _: Uuid,
        request: ModelRequest,
        _: bool,
    ) -> RunFuture<'_, PreparedSamplingContext> {
        self.prepared.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            Ok(PreparedSamplingContext {
                request,
                compacted: false,
            })
        })
    }
    fn observe_natural_end<'a>(
        &'a self,
        turn: Uuid,
        request: &'a ModelRequest,
    ) -> RunFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(self.input.closing.lock().unwrap().last(), Some(&true));
            assert!(self.input.drains.lock().unwrap().is_empty());
            assert_eq!(
                self.sink.projection.lock().unwrap().active_turn(),
                Some(turn)
            );
            assert!(
                matches!(request.messages.last(), Some(ModelMessage::Assistant { tool_calls, .. }) if tool_calls.is_empty())
            );
            self.completed.fetch_add(1, Ordering::SeqCst);
            match self.fail {
                Some(error) => Err(error.into()),
                None => Ok(()),
            }
        })
    }
}

#[tokio::test]
async fn natural_end_occurs_once_after_pending_steer_and_before_terminal_commit() {
    let (transport, sink, ids, request) = setup(vec![answer(), answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = pending(&sink);
    let boundary = EndBoundary {
        input: &input,
        sink: &sink,
        completed: AtomicUsize::new(0),
        prepared: AtomicUsize::new(0),
        fail: None,
    };
    let waits = Arc::new(Mutex::new(vec![]));
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
        &RetryRecorder(waits),
        Some(&boundary),
    )
    .await
    .unwrap();
    assert_eq!(boundary.completed.load(Ordering::SeqCst), 1);
    assert_eq!(boundary.prepared.load(Ordering::SeqCst), 1);
    assert_eq!(transport.requests.lock().unwrap().len(), 2);
    assert_eq!(result.responses.len(), 2);
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
    assert_eq!(
        sink.projection
            .lock()
            .unwrap()
            .turn(Uuid::from_u128(2))
            .unwrap()
            .outcome,
        Some(TurnOutcome::Completed)
    );
}

#[tokio::test]
async fn terminal_contributor_failure_cannot_be_reported_as_success() {
    for (error, outcome) in [
        (ModelError::Canceled, TurnOutcome::Canceled),
        (ModelError::Unavailable, TurnOutcome::Failed),
    ] {
        let (transport, sink, ids, request) = setup(vec![answer()]);
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let input = Input {
            sink: &sink,
            drains: Mutex::new(VecDeque::new()),
            closing: Mutex::new(vec![]),
            next_id: AtomicU64::new(1000),
        };
        let boundary = EndBoundary {
            input: &input,
            sink: &sink,
            completed: AtomicUsize::new(0),
            prepared: AtomicUsize::new(0),
            fail: Some(error),
        };
        let waits = Arc::new(Mutex::new(vec![]));
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
            &RetryRecorder(waits),
            Some(&boundary),
        )
        .await;
        assert!(matches!(result, Err(RunError::Model(value)) if value == error));
        assert_eq!(boundary.completed.load(Ordering::SeqCst), 1);
        assert_eq!(boundary.prepared.load(Ordering::SeqCst), 0);
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        assert_eq!(
            sink.projection
                .lock()
                .unwrap()
                .turn(Uuid::from_u128(2))
                .unwrap()
                .outcome,
            Some(outcome)
        );
    }
}

#[tokio::test]
async fn unfinished_tool_batch_does_not_reach_natural_end() {
    let (transport, sink, ids, request) = setup(vec![tool_response()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = pending(&sink);
    let boundary = EndBoundary {
        input: &input,
        sink: &sink,
        completed: AtomicUsize::new(0),
        prepared: AtomicUsize::new(0),
        fail: None,
    };
    let waits = Arc::new(Mutex::new(vec![]));
    let mut budget = limits();
    budget.model_calls = Some(1);
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: budget,
    }
    .run_with_sampling_context(
        Uuid::from_u128(2),
        request,
        &input,
        &RetryRecorder(waits),
        Some(&boundary),
    )
    .await;
    assert!(matches!(result, Err(RunError::Budget)));
    assert_eq!(boundary.completed.load(Ordering::SeqCst), 0);
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
    assert_eq!(input.drains.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn incomplete_stream_never_seals_input_or_records_terminal_context() {
    let (transport, sink, ids, request) = setup(vec![vec![begin()]]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = pending(&sink);
    let boundary = EndBoundary {
        input: &input,
        sink: &sink,
        completed: AtomicUsize::new(0),
        prepared: AtomicUsize::new(0),
        fail: None,
    };
    let waits = Arc::new(Mutex::new(vec![]));
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
        &RetryRecorder(waits),
        Some(&boundary),
    )
    .await;
    assert!(result.is_err());
    assert_eq!(boundary.completed.load(Ordering::SeqCst), 0);
    assert!(input.closing.lock().unwrap().is_empty());
    assert_eq!(input.drains.lock().unwrap().len(), 1);
}
