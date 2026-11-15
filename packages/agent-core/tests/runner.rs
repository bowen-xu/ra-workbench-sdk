use research_agent_core::{conversation::ConversationId, model::*, protocol::*, runner::*};
use serde_json::json;
use std::{
    collections::VecDeque,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    task::{Context, Waker},
};
use uuid::Uuid;

#[path = "runner/argument_feedback.rs"]
mod argument_feedback;
#[path = "runner/canonical_message.rs"]
mod canonical_message;
#[path = "runner/canonical_tool.rs"]
mod canonical_tool;
#[path = "runner/child_creation_intent.rs"]
mod child_creation_intent;
#[path = "runner/codex_response.rs"]
mod codex_response;
#[path = "runner/finalization.rs"]
mod finalization;
#[path = "runner/plugin_extensions.rs"]
mod plugin_extensions;
#[path = "runner/reasoning_identity.rs"]
mod reasoning_identity;
#[path = "runner/reasoning_summary.rs"]
mod reasoning_summary;
#[path = "runner/retry.rs"]
mod retry;
#[path = "runner/scheduling.rs"]
mod scheduling;
#[path = "runner/steering.rs"]
mod steering;
#[path = "runner/tool_cleanup.rs"]
mod tool_cleanup;
#[path = "runner/unknown_diagnostic.rs"]
mod unknown_diagnostic;
#[path = "runner/unknown_outcome.rs"]
mod unknown_outcome;
#[path = "runner/unknown_tools.rs"]
mod unknown_tools;

fn model() -> ModelIdentity {
    ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "test".into(),
        revision: None,
    }
}
fn begin() -> ModelStreamEvent {
    ModelStreamEvent::Started {
        response_id: "response".into(),
        actual_model: ModelIdentity {
            model_id: "actual-test".into(),
            ..model()
        },
    }
}
fn call(id: &str, arguments: &str) -> Vec<ModelStreamEvent> {
    vec![
        ModelStreamEvent::ToolCallStarted {
            call_id: id.into(),
            name: "read".into(),
        },
        ModelStreamEvent::ToolArgumentsDelta {
            call_id: id.into(),
            delta: arguments.into(),
        },
        ModelStreamEvent::ToolCallCompleted { call_id: id.into() },
    ]
}
fn tool_response() -> Vec<ModelStreamEvent> {
    let mut events = vec![begin()];
    events.extend(call("call-1", "{}"));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    events
}
fn answer() -> Vec<ModelStreamEvent> {
    vec![
        begin(),
        ModelStreamEvent::TextDelta("answer".into()),
        ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: None,
        },
    ]
}

struct Transport {
    responses: Mutex<VecDeque<Vec<ModelStreamEvent>>>,
    requests: Mutex<Vec<ModelRequest>>,
    drops: Arc<AtomicUsize>,
    failures: AtomicUsize,
    pending: bool,
}
struct Stream {
    events: VecDeque<ModelStreamEvent>,
    drops: Arc<AtomicUsize>,
    pending: bool,
}
impl Drop for Stream {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl ModelStream for Stream {
    fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
        Box::pin(async move {
            if self.pending {
                std::future::pending().await
            } else {
                Ok(self.events.pop_front())
            }
        })
    }
}
impl ModelTransport for Transport {
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
            self.requests.lock().unwrap().push(request);
            if self
                .failures
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                    if value > 0 { Some(value - 1) } else { None }
                })
                .is_ok()
            {
                return Err(ModelError::Unavailable);
            }
            let events = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .ok_or(ModelError::Unavailable)?;
            Ok(Box::new(Stream {
                events: events.into(),
                drops: self.drops.clone(),
                pending: self.pending,
            }) as Box<dyn ModelStream>)
        })
    }
}
struct Sink {
    projection: Mutex<ConversationProjection>,
    fail: bool,
}

struct RetryRecorder(Arc<Mutex<Vec<u64>>>);
impl RetryWait for RetryRecorder {
    fn wait(&self, delay_ms: u64) -> RunFuture<'_, ()> {
        self.0.lock().unwrap().push(delay_ms);
        Box::pin(async { Ok(()) })
    }
}
impl TurnEventSink for Sink {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            if self.fail {
                return Err(RunError::EventSink);
            }
            let mut projection = self.projection.lock().unwrap();
            let event = AgentEvent::new(
                ConversationId::from_uuid(Uuid::from_u128(1)),
                projection.seq() + 1,
                0,
                Uuid::from_u128(4),
                payload,
            )
            .unwrap();
            projection.apply(&event).unwrap();
            Ok(())
        })
    }
}
struct Tools<'a> {
    sink: &'a Sink,
    executed: AtomicUsize,
}
impl ToolExecutor for Tools<'_> {
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        if call.arguments.get("deny") == Some(&json!(true)) {
            Err(RunError::ToolRejected)
        } else {
            Ok(())
        }
    }
    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            let state = self.sink.projection.lock().unwrap();
            let turn = state.turn(Uuid::from_u128(2)).unwrap();
            assert!(
                turn.items
                    .values()
                    .any(|item| matches!(item.kind, ItemKind::ToolCall { .. }) && item.completed)
            );
            self.executed.fetch_add(1, Ordering::SeqCst);
            Ok(ToolOutput {
                content: "source text".into(),
                is_error: false,
            })
        })
    }
}
struct Ids(AtomicU64);
impl RunIdSource for Ids {
    fn next_id(&self) -> Uuid {
        Uuid::from_u128(self.0.fetch_add(1, Ordering::SeqCst) as u128)
    }
}
fn setup(responses: Vec<Vec<ModelStreamEvent>>) -> (Transport, Sink, Ids, ModelRequest) {
    let id = ConversationId::from_uuid(Uuid::from_u128(1));
    let mut projection = ConversationProjection::new(id);
    projection
        .apply(
            &AgentEvent::new(
                id,
                1,
                0,
                Uuid::from_u128(4),
                EventPayload::TurnStarted {
                    task_kind: research_agent_core::protocol::TaskKind::Regular,
                    turn_id: Uuid::from_u128(2),
                    context_snapshot_id: Uuid::from_u128(3),
                    model: model(),
                },
            )
            .unwrap(),
        )
        .unwrap();
    (
        Transport {
            responses: Mutex::new(responses.into()),
            requests: Mutex::new(vec![]),
            drops: Arc::new(AtomicUsize::new(0)),
            failures: AtomicUsize::new(0),
            pending: false,
        },
        Sink {
            projection: Mutex::new(projection),
            fail: false,
        },
        Ids(AtomicU64::new(100)),
        ModelRequest {
            captured_history: None,
            request_id: Uuid::from_u128(5),
            model: model(),
            messages: vec![ModelMessage::User {
                content: vec![ContentPart::Text("read source".into())],
                source_item_id: None,
            }],
            tools: vec![ToolDefinition {
                namespace: None,
                name: "read".into(),
                description: "Read".into(),
                parameters: json!({"type":"object"}),
            }],
            max_output_tokens: 100,
            parallel_tool_calls: false,
            reasoning_effort: None,
        },
    )
}
fn limits() -> RunLimits {
    RunLimits {
        model_calls: Some(3),
        tool_calls: Some(4),
        output_bytes: Some(1000),
        tool_output_bytes: 1000,
        response: StreamLimits {
            text_bytes: 1000,
            argument_bytes: 1000,
            tool_calls: 4,
        },
    }
}

#[tokio::test]
async fn model_tool_model_continuation_persists_intent_and_supplies_matching_history() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
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
    .await
    .unwrap();
    assert_eq!(result.responses.len(), 2);
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
    let requests = transport.requests.lock().unwrap();
    assert_ne!(requests[0].request_id, requests[1].request_id);
    assert!(
        matches!(&requests[1].messages[2], ModelMessage::ToolResult { call_id, content, .. } if call_id == "call-1" && content == "source text")
    );
    assert_eq!(
        sink.projection
            .lock()
            .unwrap()
            .turn(Uuid::from_u128(2))
            .unwrap()
            .outcome,
        Some(TurnOutcome::Completed)
    );
    assert_eq!(transport.drops.load(Ordering::SeqCst), 2);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.attempt_order.len(), 2);
    let assistant_items = turn
        .item_order
        .iter()
        .filter_map(|item_id| turn.items.get(item_id))
        .filter(|item| matches!(item.kind, ItemKind::AssistantMessage))
        .collect::<Vec<_>>();
    assert_eq!(assistant_items.len(), 1);
    assert!(
        assistant_items
            .iter()
            .all(|item| item.phase == Some(AssistantMessagePhase::FinalAnswer))
    );
    assert!(
        !assistant_items
            .iter()
            .any(|item| item.phase == Some(AssistantMessagePhase::Commentary))
    );
    for attempt in turn.attempts.values() {
        assert_eq!(attempt.requested_model.model_id, "test");
        assert_eq!(
            attempt.actual_model.as_ref().unwrap().model_id,
            "actual-test"
        );
        assert_eq!(attempt.outcome, Some(TurnOutcome::Completed));
    }
    assert!(turn.items.values().any(|item| matches!(&item.kind,
        ItemKind::ToolCall { provider_call_id: Some(id), .. } if id == "call-1")));
    assert!(turn.items.values().any(|item| matches!(
        &item.kind,
        ItemKind::ToolResult {
            is_error: Some(false),
            ..
        }
    )));
    let replay = reconstruct_history(&projection).unwrap();
    assert!(
        matches!(&replay[1], ModelMessage::ToolResult { content, is_error: false, .. } if content == "source text")
    );
    let mut next = requests[0].clone();
    next.messages = replay;
    next.validate(transport.capabilities()).unwrap();
}

struct NoAdditionalInputForTest;
impl TurnInputSource for NoAdditionalInputForTest {
    fn has_pending(&self, _: Uuid) -> RunFuture<'_, bool> {
        Box::pin(async { Ok(false) })
    }
    fn has_pending_or_seal(&self, _: Uuid) -> RunFuture<'_, bool> {
        Box::pin(async { Ok(false) })
    }
    fn drain(&self, _: Uuid, _: bool) -> RunFuture<'_, Vec<ModelMessage>> {
        Box::pin(async { Ok(Vec::new()) })
    }
}

#[tokio::test]
async fn rejected_later_tool_preserves_already_accepted_first_effect_and_result() {
    let mut events = vec![begin()];
    events.extend(call("a", "{}"));
    events.extend(call("b", "{\"deny\":true}"));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let (transport, sink, ids, request) = setup(vec![events]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    assert!(matches!(
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits()
        }
        .run(Uuid::from_u128(2), request)
        .await,
        Err(RunError::ToolRejectionDiagnostic(_))
    ));
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
    let state = sink.projection.lock().unwrap();
    assert!(
        state
            .turn(Uuid::from_u128(2))
            .unwrap()
            .items
            .values()
            .any(|item| matches!(item.kind, ItemKind::ToolResult { .. }) && item.completed)
    );
}

#[tokio::test]
async fn exhausted_model_budget_does_not_start_tools_that_cannot_continue() {
    let (transport, sink, ids, request) = setup(vec![tool_response()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    assert!(matches!(
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: RunLimits {
                model_calls: Some(1),
                ..limits()
            }
        }
        .run(Uuid::from_u128(2), request)
        .await,
        Err(RunError::Budget)
    ));
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn incomplete_stream_keeps_partial_text_and_never_executes_tools() {
    let (transport, sink, ids, request) = setup(vec![vec![
        begin(),
        ModelStreamEvent::TextDelta("partial".into()),
    ]]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    assert!(
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits()
        }
        .run(Uuid::from_u128(2), request)
        .await
        .is_err()
    );
    let state = sink.projection.lock().unwrap();
    let turn = state.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.outcome, Some(TurnOutcome::Failed));
    assert!(
        turn.items
            .values()
            .any(|item| item.text == "partial" && item.interrupted)
    );
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn sink_failure_prevents_model_work() {
    let (transport, mut sink, ids, request) = setup(vec![answer()]);
    sink.fail = true;
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    assert!(matches!(
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits()
        }
        .run(Uuid::from_u128(2), request)
        .await,
        Err(RunError::EventSink)
    ));
    assert!(transport.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn dropping_run_releases_a_pending_model_stream() {
    let (mut transport, sink, ids, request) = setup(vec![vec![]]);
    transport.pending = true;
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let runner = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    };
    let mut run = Box::pin(runner.run(Uuid::from_u128(2), request));
    assert!(
        run.as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
            .is_pending()
    );
    drop(run);
    assert_eq!(transport.drops.load(Ordering::SeqCst), 1);
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
}

#[path = "runner/receipts.rs"]
mod receipts;
