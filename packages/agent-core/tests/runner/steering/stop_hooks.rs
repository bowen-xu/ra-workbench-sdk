use super::*;

struct Hook<'a> {
    input: &'a Input<'a>,
    calls: Mutex<Vec<bool>>,
    response_texts: Mutex<Vec<String>>,
    follow_up: bool,
}

impl SamplingContext for Hook<'_> {
    fn stop_hooks(&self) -> Option<&dyn StopHooks> {
        Some(self)
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

impl StopHooks for Hook<'_> {
    fn run<'a>(
        &'a self,
        turn_id: Uuid,
        _: &'a ModelRequest,
        response: &'a ModelResponse,
        active: bool,
    ) -> RunFuture<'a, StopHookOutcome> {
        Box::pin(async move {
            self.response_texts
                .lock()
                .unwrap()
                .push(stop_hook_last_assistant_message(response).unwrap_or_default());
            let first = {
                let mut calls = self.calls.lock().unwrap();
                calls.push(active);
                calls.len() == 1
            };
            if !first {
                return Ok(StopHookOutcome::Continue);
            }
            self.input
                .drains
                .lock()
                .unwrap()
                .push_back(vec![ModelMessage::User {
                    content: vec![ContentPart::Text("arrived during hook".into())],
                    source_item_id: None,
                }]);
            if !self.follow_up {
                return Ok(StopHookOutcome::Continue);
            }
            // Model the host's durable hook item acknowledgement.
            let item_id = Uuid::from_u128(900);
            let run_id = Uuid::from_u128(902);
            let text = format!("<hook_prompt hook_run_id=\"{run_id}\">hook feedback</hook_prompt>");
            self.input
                .sink
                .emit(EventPayload::ItemAccepted {
                    turn_id,
                    item_id,
                    kind: ItemKind::HookPrompt {
                        invocation_id: Uuid::from_u128(901),
                        fragments: vec![HookPromptFragment {
                            run_id,
                            input_text: text.clone(),
                        }],
                    },
                    text: String::new(),
                    phase: None,
                    source: None,
                })
                .await?;
            Ok(StopHookOutcome::FollowUp(ModelMessage::User {
                content: vec![ContentPart::Text(text)],
                source_item_id: Some(item_id),
            }))
        })
    }
}

async fn exercise(follow_up: bool) {
    let mut revised = answer();
    revised[1] = ModelStreamEvent::TextDelta("revised".into());
    let (transport, sink, ids, request) = setup(vec![answer(), revised]);
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
    let hook = Hook {
        input: &input,
        calls: Mutex::new(vec![]),
        response_texts: Mutex::new(vec![]),
        follow_up,
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
        &input,
        &RetryRecorder(Arc::new(Mutex::new(vec![]))),
        Some(&hook),
    )
    .await
    .unwrap();
    assert_eq!(*hook.calls.lock().unwrap(), vec![false, follow_up]);
    assert_eq!(
        *hook.response_texts.lock().unwrap(),
        vec!["answer", "revised"]
    );
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    let last = &requests[1].messages;
    let texts: Vec<&str> = last
        .iter()
        .flat_map(|message| match message {
            ModelMessage::User { content, .. } => content
                .iter()
                .filter_map(|part| match part {
                    ContentPart::Text(text) => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            _ => vec![],
        })
        .collect();
    let steer = texts
        .iter()
        .position(|text| *text == "arrived during hook")
        .unwrap();
    if follow_up {
        assert!(
            texts
                .iter()
                .position(|text| text.contains("hook feedback"))
                .unwrap()
                < steer
        );
    }
}

#[tokio::test]
async fn input_arriving_during_hook_is_checked_again_before_seal() {
    exercise(false).await;
}

#[tokio::test]
async fn hook_feedback_precedes_input_and_marks_next_hook_active() {
    exercise(true).await;
}

#[tokio::test]
async fn pending_input_is_sampled_before_the_first_stop_hook() {
    let (transport, sink, ids, request) = setup(vec![answer(), answer(), answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = Input {
        sink: &sink,
        drains: Mutex::new(VecDeque::from([vec![ModelMessage::User {
            content: vec![ContentPart::Text("already pending".into())],
            source_item_id: None,
        }]])),
        closing: Mutex::new(vec![]),
        next_id: AtomicU64::new(1000),
    };
    let hook = Hook {
        input: &input,
        calls: Mutex::new(vec![]),
        response_texts: Mutex::new(vec![]),
        follow_up: false,
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
        &input,
        &RetryRecorder(Arc::new(Mutex::new(vec![]))),
        Some(&hook),
    )
    .await
    .unwrap();
    assert_eq!(*hook.calls.lock().unwrap(), vec![false, false]);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[1].messages.iter().any(|message| matches!(message, ModelMessage::User { content, .. } if content.iter().any(|part| matches!(part, ContentPart::Text(text) if text == "already pending")))));
    assert!(!requests[1].messages.iter().any(|message| matches!(message, ModelMessage::User { content, .. } if content.iter().any(|part| matches!(part, ContentPart::Text(text) if text == "arrived during hook")))));
}

#[tokio::test]
async fn tool_followup_finishes_before_stop_hook_runs() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer(), answer()]);
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
    let hook = Hook {
        input: &input,
        calls: Mutex::new(vec![]),
        response_texts: Mutex::new(vec![]),
        follow_up: false,
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
        &input,
        &RetryRecorder(Arc::new(Mutex::new(vec![]))),
        Some(&hook),
    )
    .await
    .unwrap();
    assert_eq!(*hook.calls.lock().unwrap(), vec![false, false]);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(!requests[1].messages.iter().any(|message| matches!(message, ModelMessage::User { content, .. } if content.iter().any(|part| matches!(part, ContentPart::Text(text) if text == "arrived during hook")))));
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
}

struct StoppingHook<'a> {
    input: &'a Input<'a>,
}
impl SamplingContext for StoppingHook<'_> {
    fn stop_hooks(&self) -> Option<&dyn StopHooks> {
        Some(self)
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
impl StopHooks for StoppingHook<'_> {
    fn run<'a>(
        &'a self,
        _: Uuid,
        _: &'a ModelRequest,
        _: &'a ModelResponse,
        _: bool,
    ) -> RunFuture<'a, StopHookOutcome> {
        Box::pin(async move {
            self.input
                .drains
                .lock()
                .unwrap()
                .push_back(vec![ModelMessage::User {
                    content: vec![ContentPart::Text("accepted during stop".into())],
                    source_item_id: None,
                }]);
            Ok(StopHookOutcome::Stop)
        })
    }
}
struct StopFinalizer {
    calls: AtomicUsize,
    failed: bool,
}
impl ToolExecutor for StopFinalizer {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn finalization_call(&self) -> RunFuture<'_, Option<ToolCall>> {
        Box::pin(async move {
            Ok((self.calls.load(Ordering::SeqCst) == 0).then(|| ToolCall {
                namespace: None,
                raw_arguments_json: None,
                call_id: "delivery".into(),
                name: "read".into(),
                arguments: json!({}),
            }))
        })
    }
    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            Ok(ToolOutput {
                content: "delivery result".into(),
                is_error: self.failed,
            })
        })
    }
}

#[tokio::test]
async fn stop_fences_pending_input_and_completes_delivery_without_resampling() {
    for failed in [false, true] {
        let (transport, sink, ids, request) = setup(vec![answer()]);
        let tools = StopFinalizer {
            calls: AtomicUsize::new(0),
            failed,
        };
        let input = Input {
            sink: &sink,
            drains: Mutex::new(VecDeque::new()),
            closing: Mutex::new(vec![]),
            next_id: AtomicU64::new(1000),
        };
        let hook = StoppingHook { input: &input };
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
            Some(&hook),
        )
        .await;
        if failed {
            assert!(matches!(result, Err(RunError::HostFinalizationFailed)));
        } else {
            assert!(result.is_ok());
        }
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        assert_eq!(tools.calls.load(Ordering::SeqCst), 1);
        assert_eq!(input.drains.lock().unwrap().len(), 1);
        let state = sink.projection.lock().unwrap();
        let turn = state.turn(Uuid::from_u128(2)).unwrap();
        assert_eq!(
            turn.outcome,
            Some(if failed {
                TurnOutcome::Failed
            } else {
                TurnOutcome::Completed
            })
        );
        assert!(turn.items.values().any(|item| matches!(item.kind, ItemKind::ToolResult { is_error: Some(value), .. } if value == failed)));
    }
}
