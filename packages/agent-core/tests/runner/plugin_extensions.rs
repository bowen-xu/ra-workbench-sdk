use super::*;
use research_agent_core::tool_registry::{OwnedToolRegistration, ToolRegistry};

struct SharedTools(AtomicUsize);
impl ToolExecutor for SharedTools {
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        if call.arguments.get("deny") == Some(&json!(true)) {
            Err(RunError::ToolRejected)
        } else {
            Ok(())
        }
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            self.validate(&call)?;
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(ToolOutput {
                content: "shared owner".into(),
                is_error: false,
            })
        })
    }
}

#[tokio::test]
async fn selected_provider_registrations_freeze_the_actual_request_without_granting_every_available_tool()
 {
    let shared = Arc::new(SharedTools(AtomicUsize::new(0)));
    // Application-owned available contributions, not three independent loops.
    let available = ["read", "metadata", "unselected"].map(|name| {
        OwnedToolRegistration::new(
            vec![ToolDefinition {
                namespace: None,
                name: name.into(),
                description: "Synthetic shared tool".into(),
                parameters: json!({"type": "object"}),
            }],
            shared.clone(),
        )
    });
    let first = ToolRegistry::from_registrations(
        available[..2].iter().map(OwnedToolRegistration::borrowed),
    )
    .unwrap();
    let second = ToolRegistry::from_registrations(
        available[..1].iter().map(OwnedToolRegistration::borrowed),
    )
    .unwrap();
    assert_eq!(first.definitions().len(), 2);
    assert_eq!(second.definitions().len(), 1);
    let unselected = ToolCall {
        namespace: None,
        raw_arguments_json: None,
        call_id: "unselected-call".into(),
        name: "unselected".into(),
        arguments: json!({}),
    };
    assert!(matches!(
        first.authorize_and_execute(unselected).await,
        Err(RunError::ToolNotFound)
    ));
    assert_eq!(shared.0.load(Ordering::SeqCst), 0);

    let (first_transport, first_sink, first_ids, mut first_request) =
        setup(vec![tool_response(), answer()]);
    first_request.tools = first.definitions().to_vec();
    TurnRunner {
        transport: &first_transport,
        tools: &first,
        sink: &first_sink,
        ids: &first_ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), first_request)
    .await
    .unwrap();
    for request in first_transport.requests.lock().unwrap().iter() {
        assert_eq!(
            request
                .tools
                .iter()
                .map(|definition| definition.name.as_str())
                .collect::<Vec<_>>(),
            vec!["read", "metadata"]
        );
    }
    drop(first);

    let (second_transport, second_sink, second_ids, mut second_request) =
        setup(vec![tool_response(), answer()]);
    second_request.tools = second.definitions().to_vec();
    TurnRunner {
        transport: &second_transport,
        tools: &second,
        sink: &second_sink,
        ids: &second_ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), second_request)
    .await
    .unwrap();
    for request in second_transport.requests.lock().unwrap().iter() {
        assert_eq!(
            request
                .tools
                .iter()
                .map(|definition| definition.name.as_str())
                .collect::<Vec<_>>(),
            vec!["read"]
        );
    }
    assert_eq!(shared.0.load(Ordering::SeqCst), 2);
    let rejected = ToolCall {
        namespace: None,
        raw_arguments_json: None,
        call_id: "denied-call".into(),
        name: "read".into(),
        arguments: json!({"deny": true}),
    };
    assert!(matches!(
        second.validate(&rejected),
        Err(RunError::ToolRejected)
    ));
    assert!(matches!(
        second.authorize_and_execute(rejected).await,
        Err(RunError::ToolRejected)
    ));
    assert_eq!(shared.0.load(Ordering::SeqCst), 2);
}
