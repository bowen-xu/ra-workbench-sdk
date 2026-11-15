use super::*;
use research_agent_core::tool_registry::{ToolRegistration, ToolRegistry};

#[tokio::test]
async fn cancellation_after_unroutable_raw_intent_keeps_a_paired_unexecuted_result() {
    for namespace in [None, Some(String::new()), Some("foreign::".into())] {
        let (transport, sink, tools, ids, request) = setup(vec![vec![
            start("r"),
            Ok(done(complete(
                Some(ModelOutputItem::ToolCall(ToolCallIntent {
                    call_id: "missing".into(),
                    name: if namespace.is_some() {
                        "read"
                    } else {
                        "unregistered"
                    }
                    .into(),
                    raw_arguments_json: "{".into(),
                    namespace,
                })),
                Some(native("function_call", "fc")),
            ))),
            Err(ModelError::Canceled),
        ]]);
        let registry = ToolRegistry::from_registrations([ToolRegistration::new(
            vec![ToolDefinition {
                namespace: None,
                name: "read".into(),
                description: "read".into(),
                parameters: json!({"type":"object"}),
            }],
            &tools,
        )])
        .unwrap();
        let result = TurnRunner {
            transport: &transport,
            tools: &registry,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run(Uuid::from_u128(2), request)
        .await;
        assert!(matches!(result, Err(RunError::Model(ModelError::Canceled))));
        assert_eq!(tools.calls.load(Ordering::SeqCst), 0);
        let state = sink.0.lock().unwrap();
        assert!(
            state
                .history
                .turn(Uuid::from_u128(2))
                .unwrap()
                .items
                .values()
                .any(|item| matches!(
                    item.kind,
                    ItemKind::ToolResult {
                        is_error: Some(true),
                        ..
                    }
                ) && item.text.contains("unsupported_tool"))
        );
        assert!(reconstruct_history(&state.history).is_ok());
    }
}
