use super::*;
use crate::protocol::ModelIdentity;
use std::{
    collections::VecDeque,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use uuid::Uuid;
#[path = "text_compaction_retry_tests.rs"]
mod retry_tests;

struct Transport {
    requests: Mutex<Vec<ModelRequest>>,
    events: Mutex<Vec<ModelStreamEvent>>,
    blocked: bool,
    dropped: Arc<AtomicBool>,
}
struct Stream {
    events: VecDeque<ModelStreamEvent>,
    blocked: bool,
    dropped: Arc<AtomicBool>,
}
impl Drop for Stream {
    fn drop(&mut self) {
        self.dropped.store(true, Ordering::SeqCst);
    }
}
impl ModelStream for Stream {
    fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
        Box::pin(async move {
            if self.blocked {
                std::future::pending::<()>().await;
            }
            Ok(self.events.pop_front())
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
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            Ok(Box::new(Stream {
                events: self.events.lock().unwrap().clone().into(),
                blocked: self.blocked,
                dropped: self.dropped.clone(),
            }) as Box<dyn ModelStream>)
        })
    }
}
fn request() -> CompactionRequest {
    let model = ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "model".into(),
        revision: None,
    };
    CompactionRequest {
        operation_id: Uuid::from_u128(1),
        conversation_id: Uuid::from_u128(2),
        turn_id: Uuid::from_u128(3),
        history_revision: 12,
        phase: CompactionPhase::Manual,
        binding: CompactionBinding {
            model: model.clone(),
            strategy_id: "fixture.text".into(),
            state_schema: 1,
            kind: CompactionKind::TextSummary,
        },
        source: ModelRequest {
            captured_history: None,
            request_id: Uuid::from_u128(4),
            model,
            messages: vec![
                ModelMessage::System("current research rules".into()),
                ModelMessage::User {
                    content: vec![ContentPart::Text("source: paper:v3#paragraph-4".into())],
                    source_item_id: None,
                },
                ModelMessage::Assistant {
                    phase: None,
                    content: vec![],
                    tool_calls: vec![ToolCall {
                        namespace: None,
                        raw_arguments_json: None,
                        call_id: "read-1".into(),
                        name: "read".into(),
                        arguments: serde_json::json!({"anchor":"paragraph-4"}),
                    }],
                },
                ModelMessage::ToolResult {
                    call_id: "read-1".into(),
                    content: "verified evidence".into(),
                    is_error: false,
                },
            ],
            tools: vec![ToolDefinition {
                namespace: None,
                name: "read".into(),
                description: "read source".into(),
                parameters: serde_json::json!({"type":"object"}),
            }],
            max_output_tokens: 512,
            parallel_tool_calls: false,
            reasoning_effort: None,
        },
        max_result_bytes: 4096,
    }
}
fn transport(events: Vec<ModelStreamEvent>) -> Arc<Transport> {
    Arc::new(Transport {
        requests: Mutex::new(vec![]),
        events: Mutex::new(events),
        blocked: false,
        dropped: Arc::new(AtomicBool::new(false)),
    })
}
fn events() -> Vec<ModelStreamEvent> {
    vec![
        ModelStreamEvent::Started {
            response_id: "summary-1".into(),
            actual_model: request().binding.model,
        },
        ModelStreamEvent::TextDelta("progress with paper:v3#paragraph-4".into()),
        ModelStreamEvent::Usage(ModelUsage {
            input_tokens: Some(500),
            output_tokens: Some(30),
        }),
        ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: None,
        },
    ]
}

#[test]
fn text_handoff_accepts_another_model_only_with_the_same_codec() {
    let binding = request().binding;
    let strategy = TextCompactionStrategy::new(transport(events()), binding.clone()).unwrap();
    let mut stored = binding.clone();
    stored.model.provider_id = "other-provider".into();
    stored.model.model_id = "other-model".into();
    stored.model.revision = Some("previous".into());
    assert!(strategy.accepts_binding(&stored));
    stored.state_schema += 1;
    assert!(!strategy.accepts_binding(&stored));
    stored = binding.clone();
    stored.strategy_id = "other-codec".into();
    assert!(!strategy.accepts_binding(&stored));
    stored = binding.clone();
    stored.kind = CompactionKind::RemoteOpaque;
    assert!(!strategy.accepts_binding(&stored));
    stored = binding;
    stored.model.provider_id.clear();
    assert!(!strategy.accepts_binding(&stored));
}

#[tokio::test]
async fn uses_full_snapshot_and_validates_completed_summary_without_installing_history() {
    let request = request();
    let transport = transport(events());
    let strategy = TextCompactionStrategy::new(transport.clone(), request.binding.clone()).unwrap();
    let candidate = prepare_compaction(&strategy, request.clone())
        .await
        .unwrap();
    assert!(
        candidate.output
            == CompactionOutput::TextSummary("progress with paper:v3#paragraph-4".into())
    );
    assert_eq!(candidate.usage.input_tokens, Some(500));
    assert_eq!(request.source.messages.len(), 4);
    let sent = transport.requests.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].messages.len(), 5);
    assert!(sent[0].tools.is_empty());
    assert_eq!(sent[0].request_id, request.operation_id);
    assert!(
        matches!(&sent[0].messages[3], ModelMessage::ToolResult { content, .. } if content == "verified evidence")
    );
    assert!(transport.dropped.load(Ordering::SeqCst));
}

#[tokio::test]
async fn incomplete_and_wrong_model_summaries_never_become_candidates() {
    let mut incomplete = events();
    incomplete.pop();
    let mut changed = events();
    changed[0] = ModelStreamEvent::Started {
        response_id: "other".into(),
        actual_model: ModelIdentity {
            provider_id: "another".into(),
            ..request().binding.model
        },
    };
    for events in [incomplete, changed] {
        let request = request();
        let strategy =
            TextCompactionStrategy::new(transport(events), request.binding.clone()).unwrap();
        assert!(prepare_compaction(&strategy, request).await.is_err());
    }
}

#[tokio::test]
async fn dropping_compaction_owns_and_drops_the_provider_stream() {
    let request = request();
    let mut transport = transport(events());
    Arc::get_mut(&mut transport).unwrap().blocked = true;
    let strategy = TextCompactionStrategy::new(transport.clone(), request.binding.clone()).unwrap();
    let mut operation = Box::pin(prepare_compaction(&strategy, request));
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    assert!(std::future::Future::poll(operation.as_mut(), &mut context).is_pending());
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    assert!(!transport.dropped.load(Ordering::SeqCst));
    drop(operation);
    assert!(transport.dropped.load(Ordering::SeqCst));
}

#[tokio::test]
async fn rejects_summary_tool_calls_without_executing_them() {
    let request = request();
    let events = vec![
        events()[0].clone(),
        ModelStreamEvent::ToolCallStarted {
            call_id: "unwanted".into(),
            name: "read".into(),
        },
    ];
    let strategy = TextCompactionStrategy::new(transport(events), request.binding.clone()).unwrap();
    assert!(prepare_compaction(&strategy, request).await.is_err());
}

#[tokio::test]
async fn completed_summary_function_item_is_rejected_even_without_an_executor_loop() {
    let request = request();
    let events = vec![
        events()[0].clone(),
        ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
            canonical_item_id: None,
            native: None,
            normalized: Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: "unwanted".into(),
                name: "read".into(),
                raw_arguments_json: String::new(),
                namespace: None,
            })),
        })),
        ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        },
    ];
    let strategy = TextCompactionStrategy::new(transport(events), request.binding.clone()).unwrap();
    assert!(matches!(
        prepare_compaction(&strategy, request).await,
        Err(CompactionFailure::InvalidOutput)
    ));
}

#[tokio::test]
async fn public_reasoning_never_becomes_the_text_compaction_result() {
    for answer in ["", "actual checkpoint"] {
        let request = request();
        let body = "public reasoning only";
        let mut output = vec![
            events()[0].clone(),
            ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
                canonical_item_id: None,
                native: None,
                normalized: Some(ModelOutputItem::ReasoningSummary(ReasoningSummary {
                    item_id: "rs".into(),
                    text: body.into(),
                    parts: vec![crate::protocol::ReasoningSummaryPart {
                        index: 0.into(),
                        start_byte: 0,
                        len_byte: body.len(),
                    }],
                })),
            })),
        ];
        if !answer.is_empty() {
            output.push(ModelStreamEvent::TextDelta(answer.into()));
        }
        output.push(ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: None,
        });
        let strategy =
            TextCompactionStrategy::new(transport(output), request.binding.clone()).unwrap();
        let candidate = prepare_compaction(&strategy, request).await.unwrap();
        assert!(candidate.output == CompactionOutput::TextSummary(answer.into()));
    }
}

#[tokio::test]
async fn custom_compact_prompt_replaces_only_the_synthetic_handoff_input() {
    let transport = transport(events());
    let source = request();
    let original = source.source.messages.clone();
    let prompt = "保留 DOI 和定位锚点。\n列出尚未完成的实验。";
    let strategy = TextCompactionStrategy::new(transport.clone(), source.binding.clone())
        .unwrap()
        .with_compact_prompt(prompt.into())
        .unwrap();
    prepare_compaction(&strategy, source).await.unwrap();
    let requests = transport.requests.lock().unwrap();
    assert!(requests[0].messages[..original.len()] == original);
    assert!(
        requests[0].messages.last()
            == Some(&ModelMessage::User {
                content: vec![ContentPart::Text(prompt.into())],
                source_item_id: None
            })
    );
    assert!(requests[0].tools.is_empty());
}

#[test]
fn custom_compact_prompt_rejects_empty_control_and_oversize_without_truncation() {
    for prompt in [
        " ".into(),
        "invalid\0prompt".into(),
        "x".repeat(32 * 1024 + 1),
    ] {
        assert!(validate_compact_prompt(&prompt).is_err());
    }
    assert!(validate_compact_prompt(&"x".repeat(32 * 1024)).is_ok());
    assert!(validate_compact_prompt("保留证据\n\t步骤").is_ok());
}

#[tokio::test]
async fn completed_empty_and_whitespace_suffixes_follow_text_supplier_contract() {
    for suffix in ["", " \n"] {
        let request = request();
        let mut output = events();
        output[1] = ModelStreamEvent::TextDelta(suffix.into());
        if suffix.is_empty() {
            output.remove(1);
        }
        let strategy =
            TextCompactionStrategy::new(transport(output), request.binding.clone()).unwrap();
        let candidate = prepare_compaction(&strategy, request).await.unwrap();
        assert!(candidate.output == CompactionOutput::TextSummary(suffix.into()));
    }
}
