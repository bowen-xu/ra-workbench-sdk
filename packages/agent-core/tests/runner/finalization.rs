use super::*;

struct Finalizer {
    attempted: AtomicUsize,
}
impl ToolExecutor for Finalizer {
    fn finalization_call(&self) -> RunFuture<'_, Option<ToolCall>> {
        Box::pin(async {
            Ok(
                (self.attempted.load(Ordering::SeqCst) == 0).then(|| ToolCall {
                    namespace: None,
                    raw_arguments_json: None,
                    call_id: "host-finalization".into(),
                    name: "read".into(),
                    arguments: json!({}),
                }),
            )
        })
    }
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.attempted.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(ToolOutput {
                content: "file delivery unconfirmed; do not replay".into(),
                is_error: true,
            })
        })
    }
}

#[tokio::test]
async fn host_finalization_uses_durable_tool_feedback_and_model_continuation_before_finishing() {
    let (transport, sink, ids, request) = setup(vec![answer(), answer()]);
    let tools = Finalizer {
        attempted: AtomicUsize::new(0),
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
    assert_eq!(tools.attempted.load(Ordering::SeqCst), 1);
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1].messages.iter().any(|message| matches!(message,
        ModelMessage::ToolResult { call_id, content, is_error: true } if call_id == "host-finalization" && content.contains("unconfirmed"))));
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    let messages: Vec<_> = turn
        .item_order
        .iter()
        .filter_map(|id| turn.items.get(id))
        .filter(|item| matches!(item.kind, ItemKind::AssistantMessage))
        .collect();
    assert_eq!(messages[0].phase, Some(AssistantMessagePhase::FinalAnswer));
    assert_eq!(messages[1].phase, Some(AssistantMessagePhase::FinalAnswer));
    assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
}
