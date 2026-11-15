#[path = "scheduling/failure_tests.rs"]
mod failure_tests;
#[path = "scheduling/gate_tests.rs"]
mod gate_tests;
#[path = "scheduling/terminal_dispatch.rs"]
mod terminal_dispatch;

use super::*;
use std::sync::atomic::AtomicBool;
use tokio::sync::{Barrier, Notify};

struct GateState {
    active: AtomicUsize,
    peak: AtomicUsize,
    finished: AtomicUsize,
    pair: Barrier,
    changed: Notify,
    trace: Mutex<Vec<String>>,
    receipts: Mutex<Vec<String>>,
    reject_receipt: AtomicBool,
    diagnostic_receipt: AtomicBool,
    cancel_first: AtomicBool,
    cancel_second: AtomicBool,
    wait_for_stream_close: AtomicBool,
    unknown_second: AtomicBool,
    stream_closed: AtomicBool,
    abandoned_reads: AtomicUsize,
}

impl GateState {
    fn new() -> Self {
        Self {
            active: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
            finished: AtomicUsize::new(0),
            pair: Barrier::new(2),
            changed: Notify::new(),
            trace: Mutex::new(vec![]),
            receipts: Mutex::new(vec![]),
            reject_receipt: AtomicBool::new(false),
            diagnostic_receipt: AtomicBool::new(false),
            cancel_first: AtomicBool::new(false),
            cancel_second: AtomicBool::new(false),
            wait_for_stream_close: AtomicBool::new(false),
            unknown_second: AtomicBool::new(false),
            stream_closed: AtomicBool::new(false),
            abandoned_reads: AtomicUsize::new(0),
        }
    }
}
struct GateTools<'a> {
    state: Arc<GateState>,
    sink: &'a Sink,
}
impl ToolExecutor for GateTools<'_> {
    fn supports_parallel(&self, call: &ToolCall) -> bool {
        call.arguments["parallel"] == true
    }
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            let state = &self.state;
            assert!(
                self.sink
                    .projection
                    .lock()
                    .unwrap()
                    .turn(Uuid::from_u128(2))
                    .unwrap()
                    .items
                    .values()
                    .any(|item| item.completed
                        && matches!(&item.kind,
                    ItemKind::ToolCall { provider_call_id: Some(id), .. } if id == &call.call_id))
            );
            let active = state.active.fetch_add(1, Ordering::SeqCst) + 1;
            state.peak.fetch_max(active, Ordering::SeqCst);
            if !self.supports_parallel(&call) {
                assert_eq!(active, 1);
                assert_eq!(
                    *state.receipts.lock().unwrap(),
                    ["read-a", "read-b"],
                    "exclusive work waits for durable read results and receipts"
                );
            }
            if call.call_id == "read-c" {
                assert!(state.receipts.lock().unwrap().contains(&"exclusive".into()));
            }
            state
                .trace
                .lock()
                .unwrap()
                .push(format!("start:{}", call.call_id));
            if call.arguments["pair"] == true {
                state.pair.wait().await;
            }
            tokio::task::yield_now().await;
            if call.call_id == "read-a" {
                tokio::task::yield_now().await;
            }
            while state.wait_for_stream_close.load(Ordering::SeqCst)
                && !state.stream_closed.load(Ordering::SeqCst)
            {
                tokio::task::yield_now().await;
            }
            if call.call_id == "read-a"
                && (state.unknown_second.load(Ordering::SeqCst)
                    || state.cancel_second.load(Ordering::SeqCst))
            {
                // Only finish after the runner has observed the other owner's
                // unknown outcome and released the model stream.
                while !state.stream_closed.load(Ordering::SeqCst) {
                    tokio::task::yield_now().await;
                }
            }
            if call.call_id == "read-b"
                && (state.unknown_second.load(Ordering::SeqCst)
                    || state.cancel_second.load(Ordering::SeqCst))
            {
                // Ensure the exclusive call is durably admitted before this
                // reader reports uncertainty; it must remain queued.
                while !self
                    .sink
                    .projection
                    .lock()
                    .unwrap()
                    .turn(Uuid::from_u128(2))
                    .unwrap()
                    .items
                    .values()
                    .any(|item| {
                        item.completed
                            && matches!(&item.kind,
                        ItemKind::ToolCall { provider_call_id: Some(id), .. } if id == "exclusive")
                    })
                {
                    tokio::task::yield_now().await;
                }
            }
            state
                .trace
                .lock()
                .unwrap()
                .push(format!("end:{}", call.call_id));
            state.active.fetch_sub(1, Ordering::SeqCst);
            state.finished.fetch_add(1, Ordering::SeqCst);
            state.changed.notify_one();
            if call.call_id == "read-a" && state.cancel_first.load(Ordering::SeqCst) {
                return Err(ModelError::Canceled.into());
            }
            if call.call_id == "read-b" && state.unknown_second.load(Ordering::SeqCst) {
                return Err(RunError::ToolOutcomeUnknown);
            }
            if call.call_id == "read-b" && state.cancel_second.load(Ordering::SeqCst) {
                return Err(ModelError::Canceled.into());
            }
            Ok(ToolOutput {
                content: call.call_id,
                is_error: false,
            })
        })
    }
    fn result_committed(&self, call: ToolCall) -> RunFuture<'_, ()> {
        Box::pin(async move {
            if self.state.diagnostic_receipt.load(Ordering::SeqCst) {
                let detail = ToolOutcomeDiagnostic::try_from_value(json!({
                    "code":"TOOL_RECEIPT_UNCONFIRMED","phase":"result-ack",
                    "safeCause":"owner_ack_failed","callId":call.call_id
                }))
                .unwrap();
                return Err(RunError::ToolOutcomeUnknownDiagnostic(Box::new(detail)));
            }
            if self.state.reject_receipt.load(Ordering::SeqCst) {
                return Err(RunError::EventSink);
            }
            self.state.receipts.lock().unwrap().push(call.call_id);
            self.state.changed.notify_one();
            Ok(())
        })
    }
}

struct GatedTransport {
    state: Arc<GateState>,
    responses: Mutex<VecDeque<Vec<ModelStreamEvent>>>,
    requests: Mutex<Vec<ModelRequest>>,
    gate_target: usize,
}
struct GatedStream {
    state: Arc<GateState>,
    events: VecDeque<ModelStreamEvent>,
    gate: bool,
    gate_target: usize,
}
impl Drop for GatedStream {
    fn drop(&mut self) {
        self.state.stream_closed.store(true, Ordering::SeqCst);
    }
}
struct PendingReadGuard<'a> {
    state: &'a GateState,
    pending: bool,
}
impl Drop for PendingReadGuard<'_> {
    fn drop(&mut self) {
        if self.pending {
            self.state.abandoned_reads.fetch_add(1, Ordering::SeqCst);
        }
    }
}
impl ModelStream for GatedStream {
    fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
        Box::pin(async move {
            let mut read_guard = PendingReadGuard {
                state: &self.state,
                pending: false,
            };
            if self.gate && self.gate_target == 4 {
                let required = match self.events.front() {
                    Some(ModelStreamEvent::ToolCallStarted { call_id, .. })
                        if call_id == "exclusive" =>
                    {
                        Some("read-b")
                    }
                    Some(ModelStreamEvent::ToolCallStarted { call_id, .. })
                        if call_id == "read-c" =>
                    {
                        Some("exclusive")
                    }
                    _ => None,
                };
                if let Some(required) = required {
                    while !self
                        .state
                        .receipts
                        .lock()
                        .unwrap()
                        .iter()
                        .any(|call| call == required)
                    {
                        read_guard.pending = true;
                        self.state.changed.notified().await;
                    }
                    read_guard.pending = false;
                }
            }
            if matches!(self.events.front(), Some(ModelStreamEvent::ToolCallStarted { call_id, .. })
                if call_id == "read-b")
            {
                assert!(
                    self.state
                        .trace
                        .lock()
                        .unwrap()
                        .contains(&"start:read-a".into()),
                    "item.done must dispatch before reading the next call"
                );
            }
            if self.gate
                && matches!(
                    self.events.front(),
                    Some(ModelStreamEvent::Completed { .. })
                )
            {
                // Each scenario specifies how many tools must finish before
                // the provider can deliver its terminal event.
                while self.state.finished.load(Ordering::SeqCst) < self.gate_target {
                    read_guard.pending = true;
                    self.state.changed.notified().await;
                }
                read_guard.pending = false;
            }
            Ok(self.events.pop_front())
        })
    }
}
impl ModelTransport for GatedTransport {
    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities {
            vision: true,
            tools: true,
            parallel_tools: false,
            reasoning_efforts: vec![],
        }
    }
    fn start(&self, request: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
        Box::pin(async move {
            let gate = self.requests.lock().unwrap().is_empty();
            self.requests.lock().unwrap().push(request);
            Ok(Box::new(GatedStream {
                state: self.state.clone(),
                gate,
                events: self.responses.lock().unwrap().pop_front().unwrap().into(),
                gate_target: self.gate_target,
            }) as Box<dyn ModelStream>)
        })
    }
}

#[tokio::test]
async fn conflicting_tools_finish_before_the_model_stream_closes() {
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
        gate_target: 4,
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
    .expect("conflicting tools must not wait for response completion")
    .unwrap();
    assert_eq!(state.abandoned_reads.load(Ordering::SeqCst), 0);
    assert_eq!(
        *state.receipts.lock().unwrap(),
        ["read-a", "read-b", "exclusive", "read-c"]
    );
    let requests = transport.requests.lock().unwrap();
    let calls_and_results = requests[1]
        .messages
        .iter()
        .filter_map(|message| match message {
            ModelMessage::CanonicalOutput(item)
                if matches!(&item.normalized, Some(ModelOutputItem::ToolCall(_))) =>
            {
                Some("call")
            }
            ModelMessage::ToolResult { .. } => Some("result"),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        calls_and_results,
        [
            "call", "call", "call", "call", "result", "result", "result", "result"
        ]
    );
}

#[tokio::test]
async fn in_stream_results_preserve_response_usage_baseline_and_live_context() {
    #[derive(Default)]
    struct Observer(Mutex<Vec<(&'static str, usize)>>);
    fn count(request: &ModelRequest) -> usize {
        request
            .messages
            .iter()
            .filter(|item| matches!(item, ModelMessage::ToolResult { .. }))
            .count()
    }
    impl SamplingContext for Observer {
        fn observe_item<'a>(&'a self, _: Uuid, request: &'a ModelRequest) -> RunFuture<'a, ()> {
            Box::pin(async move {
                self.0.lock().unwrap().push(("item", count(request)));
                Ok(())
            })
        }
        fn observe_response<'a>(
            &'a self,
            _: Uuid,
            request: &'a ModelRequest,
            _: &'a ModelResponse,
        ) -> RunFuture<'a, ()> {
            Box::pin(async move {
                self.0.lock().unwrap().push(("response", count(request)));
                Ok(())
            })
        }
        fn observe_tool_result<'a>(
            &'a self,
            _: Uuid,
            request: &'a ModelRequest,
        ) -> RunFuture<'a, ()> {
            Box::pin(async move {
                self.0.lock().unwrap().push(("tool", count(request)));
                Ok(())
            })
        }
        fn prepare(
            &self,
            _: Uuid,
            request: ModelRequest,
            _: bool,
        ) -> RunFuture<'_, PreparedSamplingContext> {
            Box::pin(async {
                Ok(PreparedSamplingContext {
                    request,
                    compacted: false,
                })
            })
        }
    }
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
        gate_target: 4,
    };
    let observer = Observer::default();
    let runner = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runner.run_with_sampling_context(
            Uuid::from_u128(2),
            request,
            &NoAdditionalInputForTest,
            &RetryRecorder(Arc::new(Mutex::new(vec![]))),
            Some(&observer),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    let trace = observer.0.lock().unwrap();
    let first_response = trace
        .iter()
        .position(|entry| *entry == ("response", 0))
        .unwrap();
    assert!(trace[..first_response].contains(&("tool", 4)));
    assert_eq!(trace[first_response + 1], ("item", 4));
    assert_eq!(trace.iter().filter(|entry| entry.0 == "tool").count(), 4);
    assert!(trace[first_response + 2..].contains(&("response", 4)));
}

#[tokio::test]
async fn dependent_exclusive_queries_are_seeded_then_observe_committed_predecessor_results() {
    struct LiveContext(Mutex<Option<ModelRequest>>);
    impl ToolExecutor for LiveContext {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
            Box::pin(async {
                let request = self
                    .0
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("item observer seeds first query");
                let prior_results = request
                    .messages
                    .iter()
                    .filter(|message| matches!(message, ModelMessage::ToolResult { .. }))
                    .count();
                Ok(ToolOutput {
                    content: prior_results.to_string(),
                    is_error: false,
                })
            })
        }
    }
    impl SamplingContext for LiveContext {
        fn observe_item<'a>(&'a self, _: Uuid, request: &'a ModelRequest) -> RunFuture<'a, ()> {
            Box::pin(async move {
                *self.0.lock().unwrap() = Some(request.clone());
                Ok(())
            })
        }
        fn observe_response<'a>(
            &'a self,
            turn: Uuid,
            request: &'a ModelRequest,
            _: &'a ModelResponse,
        ) -> RunFuture<'a, ()> {
            self.observe_item(turn, request)
        }
        fn observe_tool_result<'a>(
            &'a self,
            turn: Uuid,
            request: &'a ModelRequest,
        ) -> RunFuture<'a, ()> {
            self.observe_item(turn, request)
        }
        fn prepare(
            &self,
            _: Uuid,
            request: ModelRequest,
            _: bool,
        ) -> RunFuture<'_, PreparedSamplingContext> {
            Box::pin(async {
                Ok(PreparedSamplingContext {
                    request,
                    compacted: false,
                })
            })
        }
    }
    let mut events = vec![begin()];
    events.extend(call("first-query", "{}"));
    events.extend(call("dependent-query", "{}"));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let (transport, sink, ids, request) = setup(vec![events, answer()]);
    let owner = LiveContext(Mutex::new(None));
    TurnRunner {
        transport: &transport,
        tools: &owner,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_sampling_context(
        Uuid::from_u128(2),
        request,
        &NoAdditionalInputForTest,
        &RetryRecorder(Arc::new(Mutex::new(vec![]))),
        Some(&owner),
    )
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    let outputs: Vec<_> = requests[1]
        .messages
        .iter()
        .filter_map(|message| match message {
            ModelMessage::ToolResult { content, .. } => Some(content.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(outputs, ["0", "1"]);
}
