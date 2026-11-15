//! Draft tool parameters never authorize work; done arguments do.
use super::*;
use research_agent_core::tool_registry::{ToolRegistration, ToolRegistry};

fn corrected_tool(raw: &str) -> Vec<ModelStreamEvent> {
    corrected_route("read", raw, None)
}
fn corrected_route(name: &str, raw: &str, namespace: Option<&str>) -> Vec<ModelStreamEvent> {
    vec![
        begin(),
        ModelStreamEvent::ToolCallStarted {
            call_id: "canonical-call".into(),
            name: "read".into(),
        },
        ModelStreamEvent::ToolArgumentsDelta {
            call_id: "canonical-call".into(),
            delta: r#"{"value":"draft"}"#.into(),
        },
        ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
            canonical_item_id: None,
            normalized: Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: "canonical-call".into(),
                name: name.into(),
                raw_arguments_json: raw.into(),
                namespace: namespace.map(str::to_owned),
            })),
            native: None,
        })),
        ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        },
    ]
}

struct CanonicalTools<'a> {
    sink: &'a Sink,
    expected: &'a str,
    effects: AtomicUsize,
    receipts: AtomicUsize,
}
impl ToolExecutor for CanonicalTools<'_> {
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        assert_eq!(call.arguments, json!({"value":"done"}));
        let projection = self.sink.projection.lock().unwrap();
        assert!(projection.turn(Uuid::from_u128(2)).unwrap().items.values().any(|item|
            item.accepted && item.completed && item.text == self.expected
            && matches!(&item.kind, ItemKind::ToolCall { provider_call_id: Some(id), .. } if id == "canonical-call")));
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.validate(&call).unwrap();
        self.effects.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(ToolOutput {
                content: "completed effect".into(),
                is_error: false,
            })
        })
    }
    fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
        self.receipts.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test]
async fn canonical_done_parameters_are_recorded_and_authorized_once_before_followup() {
    let raw = r#" {"value":"done"} "#;
    let (transport, sink, ids, request) = setup(vec![corrected_tool(raw), answer()]);
    let tools = CanonicalTools {
        sink: &sink,
        expected: raw,
        effects: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
    };
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
    assert_eq!(tools.effects.load(Ordering::SeqCst), 1);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 1);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1].messages.iter().any(|message|matches!(message,ModelMessage::CanonicalOutput(item)
        if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call)) if call.raw_arguments_json == raw))));
    assert_eq!(requests[1].messages.iter().filter(|message|matches!(message,ModelMessage::ToolResult {call_id,is_error:false,..} if call_id == "canonical-call")).count(),1);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(
        turn.items
            .values()
            .filter(|item| matches!(item.kind, ItemKind::ToolCall { .. }))
            .count(),
        1
    );
    assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
}

#[tokio::test]
async fn invalid_canonical_parameters_get_feedback_without_executing_valid_draft() {
    let (transport, sink, ids, request) = setup(vec![corrected_tool("{"), answer()]);
    let tools = CanonicalTools {
        sink: &sink,
        expected: "{",
        effects: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
    };
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
    assert_eq!(tools.effects.load(Ordering::SeqCst), 0);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 0);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1].messages.iter().any(|message|matches!(message,ModelMessage::CanonicalOutput(item)
        if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call)) if call.raw_arguments_json == "{"))));
    assert!(requests[1].messages.iter().any(
        |message| matches!(message,ModelMessage::ToolResult {call_id,is_error:true,content,..}
        if call_id == "canonical-call" && content.contains("invalid_tool_arguments"))
    ));
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(
        turn.items
            .values()
            .find(|item| matches!(item.kind, ItemKind::ToolCall { .. }))
            .unwrap()
            .text,
        "{"
    );
    assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
}

struct RouteOwner<'a> {
    name: &'static str,
    sink: &'a Sink,
    validated: AtomicUsize,
    effects: AtomicUsize,
    receipts: AtomicUsize,
}
impl<'a> RouteOwner<'a> {
    fn new(name: &'static str, sink: &'a Sink) -> Self {
        Self {
            name,
            sink,
            validated: AtomicUsize::new(0),
            effects: AtomicUsize::new(0),
            receipts: AtomicUsize::new(0),
        }
    }
}
impl ToolExecutor for RouteOwner<'_> {
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        assert_eq!(call.name, self.name);
        let projection = self.sink.projection.lock().unwrap();
        assert!(
            projection
                .turn(Uuid::from_u128(2))
                .unwrap()
                .items
                .values()
                .any(|item| item.accepted
                    && item.completed
                    && matches!(&item.kind, ItemKind::ToolCall { name, .. } if name == self.name))
        );
        self.validated.fetch_add(1, Ordering::SeqCst);
        if call.arguments.get("deny") == Some(&json!(true)) {
            return Err(RunError::ToolRejected);
        }
        if call.arguments.get("value") != Some(&json!("done")) {
            return Err(RunError::ToolArguments(
                "The final route requires value=done.".into(),
            ));
        }
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        assert_eq!(call.name, self.name);
        assert_eq!(call.arguments, json!({"value":"done"}));
        self.effects.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(ToolOutput {
                content: "final route effect".into(),
                is_error: false,
            })
        })
    }
    fn result_committed(&self, call: ToolCall) -> RunFuture<'_, ()> {
        assert_eq!(call.name, self.name);
        self.receipts.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}
fn routes<'a>(read: &'a RouteOwner<'a>, write: &'a RouteOwner<'a>) -> ToolRegistry<'a> {
    ToolRegistry::from_registrations([read, write].map(|owner| {
        ToolRegistration::new(
            vec![ToolDefinition {
                namespace: None,
                name: owner.name.into(),
                description: "Final route".into(),
                parameters: json!({"type":"object"}),
            }],
            owner,
        )
    }))
    .unwrap()
}

#[tokio::test]
async fn canonical_done_name_selects_only_the_final_registered_handler_and_receipt() {
    let (transport, sink, ids, mut request) = setup(vec![
        corrected_route("write", r#"{"value":"done"}"#, None),
        answer(),
    ]);
    let read = RouteOwner::new("read", &sink);
    let write = RouteOwner::new("write", &sink);
    let tools = routes(&read, &write);
    request.tools = tools.definitions().to_vec();
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
    assert_eq!(read.validated.load(Ordering::SeqCst), 0);
    assert_eq!(read.effects.load(Ordering::SeqCst), 0);
    assert_eq!(read.receipts.load(Ordering::SeqCst), 0);
    assert_eq!(write.validated.load(Ordering::SeqCst), 1);
    assert_eq!(write.effects.load(Ordering::SeqCst), 1);
    assert_eq!(write.receipts.load(Ordering::SeqCst), 1);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1].messages.iter().any(|message| matches!(message,ModelMessage::CanonicalOutput(item)
        if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call)) if call.name=="write" && call.call_id=="canonical-call"))));
}

#[tokio::test]
async fn canonical_unknown_name_or_namespace_cannot_reuse_the_draft_route() {
    for (name, namespace) in [
        ("unknown", None),
        ("write", Some("foreign::")),
        ("write", Some("")),
    ] {
        let (transport, sink, ids, mut request) =
            setup(vec![corrected_route(name, "{", namespace), answer()]);
        let read = RouteOwner::new("read", &sink);
        let write = RouteOwner::new("write", &sink);
        let tools = routes(&read, &write);
        request.tools = tools.definitions().to_vec();
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
        for owner in [&read, &write] {
            assert_eq!(owner.validated.load(Ordering::SeqCst), 0);
            assert_eq!(owner.effects.load(Ordering::SeqCst), 0);
            assert_eq!(owner.receipts.load(Ordering::SeqCst), 0);
        }
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].messages.iter().any(|message|matches!(message,ModelMessage::ToolResult {call_id,is_error:true,content}
            if call_id=="canonical-call" && content.contains("unsupported_tool") && !content.contains("invalid_tool_arguments"))));
        assert!(requests[1].messages.iter().any(|message|matches!(message,ModelMessage::CanonicalOutput(item)
            if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call))if call.name==name && call.namespace.as_deref()==namespace && call.raw_arguments_json=="{"))));
    }
}

#[tokio::test]
async fn canonical_changed_name_still_obeys_its_final_schema_and_authorization() {
    for (raw, denied) in [(r#"{"value":"wrong"}"#, false), (r#"{"deny":true}"#, true)] {
        let (transport, sink, ids, mut request) =
            setup(vec![corrected_route("write", raw, None), answer()]);
        let read = RouteOwner::new("read", &sink);
        let write = RouteOwner::new("write", &sink);
        let tools = routes(&read, &write);
        request.tools = tools.definitions().to_vec();
        let result = TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run(Uuid::from_u128(2), request)
        .await;
        if denied {
            assert!(matches!(result, Err(RunError::ToolRejectionDiagnostic(_))));
        } else {
            result.unwrap();
        }
        assert_eq!(read.validated.load(Ordering::SeqCst), 0);
        assert_eq!(read.effects.load(Ordering::SeqCst), 0);
        assert_eq!(read.receipts.load(Ordering::SeqCst), 0);
        assert_eq!(write.validated.load(Ordering::SeqCst), 1);
        assert_eq!(write.effects.load(Ordering::SeqCst), 0);
        assert_eq!(write.receipts.load(Ordering::SeqCst), 0);
        assert_eq!(
            transport.requests.lock().unwrap().len(),
            if denied { 1 } else { 2 }
        );
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert_eq!(
            turn.outcome,
            Some(if denied {
                TurnOutcome::Failed
            } else {
                TurnOutcome::Completed
            })
        );
        assert!(turn.items.values().any(
            |item| matches!(&item.kind,ItemKind::ToolCall{name,..}if name=="write")
                && item.text == raw
        ));
    }
}
