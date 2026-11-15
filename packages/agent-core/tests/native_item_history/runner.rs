use super::*;
#[path = "runner_unknown.rs"]
mod unknown_tools;
use research_agent_core::{conversation::ConversationId, runner::*};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
};

struct State {
    history: ConversationProjection,
    events: Vec<AgentEvent>,
}
struct Sink(Arc<Mutex<State>>);
impl TurnEventSink for Sink {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self.0.lock().unwrap();
            let event = AgentEvent::new(
                state.history.conversation_id(),
                state.history.seq() + 1,
                0,
                Uuid::from_u128(4),
                payload,
            )
            .map_err(|_| RunError::EventSink)?;
            state
                .history
                .apply(&event)
                .map_err(|_| RunError::EventSink)?;
            state.events.push(event);
            Ok(())
        })
    }
}
struct Stream(VecDeque<Result<ModelStreamEvent, ModelError>>);
impl ModelStream for Stream {
    fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
        Box::pin(async move { self.0.pop_front().transpose() })
    }
}
struct Transport {
    streams: Mutex<VecDeque<Vec<Result<ModelStreamEvent, ModelError>>>>,
    requests: Mutex<Vec<ModelRequest>>,
}
impl ModelTransport for Transport {
    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities {
            vision: false,
            tools: true,
            parallel_tools: false,
            reasoning_efforts: vec![],
        }
    }
    fn start(&self, request: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
        Box::pin(async move {
            self.requests.lock().unwrap().push(request);
            let stream = self
                .streams
                .lock()
                .unwrap()
                .pop_front()
                .ok_or(ModelError::Unavailable)?;
            Ok(Box::new(Stream(stream.into())) as Box<dyn ModelStream>)
        })
    }
}
struct Tools {
    state: Arc<Mutex<State>>,
    calls: AtomicUsize,
}
impl ToolExecutor for Tools {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            // The side effect sees the entire native call already accepted, not a
            // later response checkpoint or a separately committed opaque record.
            assert!(
                self.state
                    .lock()
                    .unwrap()
                    .history
                    .turn(Uuid::from_u128(2))
                    .unwrap()
                    .items
                    .values()
                    .any(|item| matches!(item.kind, ItemKind::ToolCall { .. })
                        && item.completed
                        && item
                            .source
                            .as_ref()
                            .is_some_and(|source| source.provider_data_json.is_some()))
            );
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(ToolOutput {
                content: "evidence".into(),
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

fn setup(
    streams: Vec<Vec<Result<ModelStreamEvent, ModelError>>>,
) -> (Transport, Sink, Tools, Ids, ModelRequest) {
    let conversation = ConversationId::from_uuid(Uuid::from_u128(1));
    let turn = Uuid::from_u128(2);
    let user = Uuid::from_u128(10);
    let state = Arc::new(Mutex::new(State {
        history: ConversationProjection::new(conversation),
        events: vec![],
    }));
    let sink = Sink(state.clone());
    for payload in [
        EventPayload::TurnStarted {
            turn_id: turn,
            context_snapshot_id: Uuid::from_u128(3),
            model: model(),
            task_kind: TaskKind::Regular,
        },
        EventPayload::ItemStarted {
            turn_id: turn,
            item_id: user,
            kind: ItemKind::UserMessage,
        },
        EventPayload::TextDelta {
            turn_id: turn,
            item_id: user,
            text: "question".into(),
        },
        EventPayload::ItemCompleted {
            turn_id: turn,
            item_id: user,
        },
    ] {
        let mut value = state.lock().unwrap();
        let event = AgentEvent::new(
            conversation,
            value.history.seq() + 1,
            0,
            Uuid::from_u128(4),
            payload,
        )
        .unwrap();
        value.history.apply(&event).unwrap();
        value.events.push(event);
    }
    let request = ModelRequest {
        request_id: Uuid::from_u128(4),
        model: model(),
        messages: vec![ModelMessage::User {
            content: vec![ContentPart::Text("question".into())],
            source_item_id: Some(user),
        }],
        tools: vec![ToolDefinition {
            namespace: None,
            name: "read".into(),
            description: "fixture read".into(),
            parameters: json!({"type":"object"}),
        }],
        max_output_tokens: 1000,
        parallel_tool_calls: false,
        reasoning_effort: None,
        captured_history: Some(CapturedHistoryRef {
            conversation_id: *conversation.as_uuid(),
            through_seq: 4,
            after_seq: 0,
            turns: vec![CapturedTurnRef {
                turn_id: turn,
                user_item_ids: vec![user],
            }],
        }),
    };
    (
        Transport {
            streams: Mutex::new(streams.into()),
            requests: Mutex::new(vec![]),
        },
        sink,
        Tools {
            state,
            calls: AtomicUsize::new(0),
        },
        Ids(AtomicU64::new(1000)),
        request,
    )
}
fn limits() -> RunLimits {
    RunLimits {
        model_calls: Some(3),
        tool_calls: Some(8),
        output_bytes: Some(65536),
        tool_output_bytes: 65536,
        response: StreamLimits {
            text_bytes: 65536,
            argument_bytes: 65536,
            tool_calls: 8,
        },
    }
}
fn start(response: &str) -> Result<ModelStreamEvent, ModelError> {
    Ok(ModelStreamEvent::StartedWithoutModel {
        response_id: response.into(),
    })
}
fn reasoning() -> Result<ModelStreamEvent, ModelError> {
    Ok(done(complete(None, Some(native("reasoning", "r")))))
}

#[tokio::test]
async fn cancellation_after_invalid_intent_keeps_parameter_feedback_without_starting_an_executor() {
    let (transport, sink, tools, ids, request) = setup(vec![vec![
        start("r"),
        Ok(done(complete(
            Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: "bad".into(),
                name: "read".into(),
                raw_arguments_json: "{".into(),
                namespace: None,
            })),
            Some(native("function_call", "fc")),
        ))),
        Err(ModelError::Canceled),
    ]]);
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::Model(ModelError::Canceled))));
    assert_eq!(tools.calls.load(Ordering::SeqCst), 0);
    let state = sink.0.lock().unwrap();
    let turn = state.history.turn(Uuid::from_u128(2)).unwrap();
    assert!(turn.items.values().any(|item| item.completed
        && matches!(
            item.kind,
            ItemKind::ToolResult {
                is_error: Some(true),
                ..
            }
        )
        && item.text.contains("invalid_tool_arguments")));
    assert!(reconstruct_history(&state.history).is_ok());
}

#[tokio::test]
async fn native_facts_survive_late_stream_failure_replay_and_tool_effect_executes_once() {
    let raw = "{\n \"q\" : 1\n}";
    let first = vec![
        start("response"),
        reasoning(),
        Ok(done(complete(
            Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: "wire-call".into(),
                name: "read".into(),
                raw_arguments_json: raw.into(),
                namespace: None,
            })),
            Some(native("function_call", "fc")),
        ))),
        Err(ModelError::Unavailable),
    ];
    let mut answer = native("message", "answer");
    answer.response_id = Some("retry".into());
    let second = vec![
        start("retry"),
        Ok(done(complete(
            Some(ModelOutputItem::Message(AssistantMessage {
                item_id: "answer".into(),
                text: "answer".into(),
                phase: Some(AssistantMessagePhase::FinalAnswer),
            })),
            Some(answer),
        ))),
        Ok(ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: Some(true),
        }),
    ];
    let (transport, sink, tools, ids, request) = setup(vec![first, second]);
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
    assert_eq!(tools.calls.load(Ordering::SeqCst), 1);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    let canonical = requests[1]
        .messages
        .iter()
        .filter_map(|message| match message {
            ModelMessage::CanonicalOutput(item) => Some(item),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(canonical.len(), 2);
    assert!(
        canonical
            .iter()
            .all(|item| item.canonical_item_id.is_some())
    );
    assert!(canonical[0].normalized.is_none());
    assert!(
        matches!(&canonical[1].normalized,Some(ModelOutputItem::ToolCall(call)) if call.raw_arguments_json==raw)
    );
    let state = sink.0.lock().unwrap();
    let history = state.history.clone();
    let events = state.events.clone();
    drop(state);
    let accepted = events
        .iter()
        .filter_map(|event| match event.payload() {
            EventPayload::ItemAccepted {
                source: Some(source),
                kind,
                ..
            } => Some((source, kind)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        accepted
            .iter()
            .map(|(source, _)| source.ordinal)
            .collect::<Vec<_>>(),
        [0, 1, 0]
    );
    assert!(matches!(accepted[0].1,ItemKind::ProviderNative{item_type} if item_type=="reasoning"));
    let encoded = serde_json::to_string(&events).unwrap();
    let reopened: Vec<AgentEvent> = serde_json::from_str(&encoded).unwrap();
    let mut projection = ConversationProjection::new(history.conversation_id());
    for event in &reopened {
        projection.apply(event).unwrap();
    }
    assert_eq!(projection, history);
    let replay = reconstruct_history(&projection).unwrap();
    assert!(
        matches!(&replay[0],ModelMessage::User {source_item_id:Some(id),..} if *id==Uuid::from_u128(10))
    );
    let canonical = replay
        .iter()
        .filter_map(|message| match message {
            ModelMessage::CanonicalOutput(item) => Some(item),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(canonical.len(), 3);
    assert_eq!(
        canonical[0].native.as_ref().unwrap().data["item"]["encrypted_content"],
        "opaque-signature"
    );
    assert!(
        matches!(&canonical[1].normalized,Some(ModelOutputItem::ToolCall(call)) if call.raw_arguments_json==raw && call.call_id.starts_with("call_"))
    );

    // A process boundary before the result is not permission to re-run it.
    let mut unknown = ConversationProjection::new(history.conversation_id());
    for event in &events {
        unknown.apply(event).unwrap();
        if matches!(
            event.payload(),
            EventPayload::ItemAccepted {
                kind: ItemKind::ToolCall { .. },
                ..
            }
        ) {
            break;
        }
    }
    unknown
        .apply(
            &AgentEvent::new(
                unknown.conversation_id(),
                unknown.seq() + 1,
                0,
                Uuid::from_u128(4),
                EventPayload::TurnFinished {
                    turn_id: Uuid::from_u128(2),
                    outcome: TurnOutcome::Interrupted,
                },
            )
            .unwrap(),
        )
        .unwrap();
    assert!(unknown.has_unknown_tool_outcome());
    assert!(matches!(
        reconstruct_history_for_continuation(&unknown, &Default::default()),
        Err(HistoryError::ToolOutcomeUnknown)
    ));
}

#[tokio::test]
async fn failed_partial_message_preserves_native_reasoning_without_a_fake_assistant_item() {
    let events = vec![
        start("response"),
        reasoning(),
        Ok(ModelStreamEvent::AssistantMessageStarted {
            item_id: "draft".into(),
            phase: None,
        }),
        Ok(ModelStreamEvent::AssistantTextDelta {
            item_id: "draft".into(),
            text: "unfinished".into(),
        }),
        Err(ModelError::InvalidStream),
    ];
    let (transport, sink, tools, ids, request) = setup(vec![events]);
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
    let projection = sink.0.lock().unwrap().history.clone();
    let messages = reconstruct_history_for_continuation(&projection, &Default::default()).unwrap();
    assert_eq!(messages.len(), 2);
    assert!(
        matches!(&messages[1],ModelMessage::CanonicalOutput(item) if item.normalized.is_none() && item.native.as_ref().unwrap().item_type=="reasoning")
    );
    assert_eq!(tools.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn sparse_done_body_obeys_the_same_turn_output_budget_as_deltas() {
    for prefix in [None, Some("ab")] {
        let mut events = vec![start("response")];
        if let Some(prefix) = prefix {
            events.push(Ok(ModelStreamEvent::AssistantMessageStarted {
                item_id: "answer".into(),
                phase: None,
            }));
            events.push(Ok(ModelStreamEvent::AssistantTextDelta {
                item_id: "answer".into(),
                text: prefix.into(),
            }));
        }
        events.push(Ok(done(complete(
            Some(ModelOutputItem::Message(AssistantMessage {
                item_id: "answer".into(),
                text: "abcde".into(),
                phase: None,
            })),
            Some(native("message", "answer")),
        ))));
        let (transport, sink, tools, ids, request) = setup(vec![events]);
        let mut budget = limits();
        budget.output_bytes = Some(4);
        assert!(matches!(
            TurnRunner {
                transport: &transport,
                tools: &tools,
                sink: &sink,
                ids: &ids,
                limits: budget
            }
            .run(Uuid::from_u128(2), request)
            .await,
            Err(RunError::Budget)
        ));
        assert!(!sink.0.lock().unwrap().events.iter().any(|event| matches!(
            event.payload(),
            EventPayload::ItemAccepted {
                kind: ItemKind::AssistantMessage,
                ..
            }
        )));
    }
}
