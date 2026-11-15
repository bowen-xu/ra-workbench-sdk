//! Codex registry/router/parallel at e363b08c: missing handlers are feedback;
//! permission rejection from a selected handler remains a fatal local boundary.
use super::*;
use research_agent_core::tool_registry::{ToolRegistration, ToolRegistry};

struct GuardedTools {
    validated: Mutex<Vec<String>>,
    executed: Mutex<Vec<String>>,
    receipted: Mutex<Vec<String>>,
}
impl GuardedTools {
    fn new() -> Self {
        Self {
            validated: Mutex::new(vec![]),
            executed: Mutex::new(vec![]),
            receipted: Mutex::new(vec![]),
        }
    }
}
impl ToolExecutor for GuardedTools {
    fn resolve_qualified_name(&self, namespace: Option<&str>, name: &str) -> ToolNameResolution {
        if name == "read" && (namespace.is_none() || namespace == Some("registered")) {
            ToolNameResolution::Registered
        } else {
            ToolNameResolution::NotFound
        }
    }
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        self.validated.lock().unwrap().push(call.call_id.clone());
        if call.arguments.get("deny") == Some(&json!(true)) {
            return Err(RunError::ToolRejected);
        }
        if call.arguments.get("disappeared") == Some(&json!(true)) {
            return Err(RunError::ToolNotFound);
        }
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        if call.arguments.get("goneAtDispatch") == Some(&json!(true)) {
            return Box::pin(async { Err(RunError::ToolNotFound) });
        }
        self.executed.lock().unwrap().push(call.call_id);
        Box::pin(async {
            Ok(ToolOutput {
                content: "authorized evidence".into(),
                is_error: false,
            })
        })
    }
    fn result_committed(&self, call: ToolCall) -> RunFuture<'_, ()> {
        self.receipted.lock().unwrap().push(call.call_id);
        Box::pin(async { Ok(()) })
    }
}
fn registry(tools: &GuardedTools) -> ToolRegistry<'_> {
    ToolRegistry::from_registrations([ToolRegistration::new(
        vec![ToolDefinition {
            namespace: None,
            name: "read".into(),
            description: "Read this host's authorized evidence".into(),
            parameters: json!({"type":"object"}),
        }],
        tools,
    )])
    .unwrap()
}
fn response(calls: &[(&str, &str, &str)]) -> Vec<ModelStreamEvent> {
    let mut events = vec![begin()];
    for (id, name, raw) in calls {
        events.extend([
            ModelStreamEvent::ToolCallStarted {
                call_id: (*id).into(),
                name: (*name).into(),
            },
            ModelStreamEvent::ToolArgumentsDelta {
                call_id: (*id).into(),
                delta: (*raw).into(),
            },
            ModelStreamEvent::ToolCallCompleted {
                call_id: (*id).into(),
            },
        ]);
    }
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    events
}

#[tokio::test]
async fn unknown_malformed_name_is_feedback_before_parse_then_correction_executes_once() {
    let (transport, sink, ids, mut request) = setup(vec![
        response(&[("prior", "read", "{}"), ("missing", "does_not_exist", "{")]),
        response(&[("corrected", "read", "{}")]),
        answer(),
    ]);
    // Request advertising does not replace the host's actual route/permission.
    request.tools.clear();
    let owner = GuardedTools::new();
    let tools = registry(&owner);
    assert_eq!(
        owner.resolve_name("anything"),
        ToolNameResolution::Unspecified
    );
    assert_eq!(tools.resolve_name("read"), ToolNameResolution::Registered);
    assert_eq!(
        tools.resolve_name("does_not_exist"),
        ToolNameResolution::NotFound
    );
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
    assert_eq!(*owner.validated.lock().unwrap(), ["prior", "corrected"]);
    assert_eq!(*owner.executed.lock().unwrap(), ["prior", "corrected"]);
    assert_eq!(*owner.receipted.lock().unwrap(), ["prior", "corrected"]);
    let sent = transport.requests.lock().unwrap();
    assert_eq!(sent.len(), 3);
    assert!(sent[1].messages.iter().any(|message|matches!(message,ModelMessage::CanonicalOutput(item)
        if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call))if call.name=="does_not_exist"&&call.raw_arguments_json=="{"))));
    assert!(sent[1].messages.iter().any(|message|matches!(message,ModelMessage::ToolResult {call_id,content,is_error:true}
        if call_id=="missing"&&content.contains("unsupported_tool")&&!content.contains("invalid_tool_arguments"))));
    for request in sent.iter() {
        request.validate(transport.capabilities()).unwrap();
    }
    let replay = reconstruct_history(&sink.projection.lock().unwrap()).unwrap();
    assert!(replay.iter().any(|message|matches!(message,ModelMessage::ToolResult {content,is_error:true,..}if content.contains("unsupported_tool"))));
}

#[tokio::test]
async fn selected_handler_authorization_is_fatal_and_never_becomes_unknown_routing() {
    let (transport, sink, ids, request) =
        setup(vec![response(&[("denied", "read", "{\"deny\":true}")])]);
    let owner = GuardedTools::new();
    let tools = registry(&owner);
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::ToolRejectionDiagnostic(_))));
    assert_eq!(*owner.validated.lock().unwrap(), ["denied"]);
    assert!(owner.executed.lock().unwrap().is_empty());
    assert!(owner.receipted.lock().unwrap().is_empty());
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let projection = sink.projection.lock().unwrap();
    assert!(reconstruct_history(&projection).is_ok());
    assert!(
        projection
            .turn(Uuid::from_u128(2))
            .unwrap()
            .items
            .values()
            .any(|item| item.text.contains("tool_not_started"))
    );
}

#[tokio::test]
async fn explicit_route_disappearance_during_validation_is_recoverable_without_execution() {
    let (transport, sink, ids, request) = setup(vec![
        response(&[("gone", "read", "{\"disappeared\":true}")]),
        answer(),
    ]);
    let owner = GuardedTools::new();
    let tools = registry(&owner);
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
    assert!(owner.executed.lock().unwrap().is_empty());
    assert!(owner.receipted.lock().unwrap().is_empty());
    assert!(transport.requests.lock().unwrap()[1].messages.iter().any(|message|matches!(message,
        ModelMessage::ToolResult {content,is_error:true,..}if content.contains("unsupported_tool"))));
}

#[tokio::test]
async fn route_disappearance_before_dispatch_has_feedback_and_no_effect_receipt() {
    let (transport, sink, ids, request) = setup(vec![
        response(&[("gone", "read", "{\"goneAtDispatch\":true}")]),
        answer(),
    ]);
    let owner = GuardedTools::new();
    let tools = registry(&owner);
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
    assert!(owner.executed.lock().unwrap().is_empty());
    assert!(owner.receipted.lock().unwrap().is_empty());
    assert!(transport.requests.lock().unwrap()[1].messages.iter().any(|message|matches!(message,
        ModelMessage::ToolResult {content,is_error:true,..}if content.contains("unsupported_tool"))));
}

#[tokio::test]
async fn foreign_and_empty_namespaces_never_resolve_a_registered_bare_name_then_correct() {
    for namespace in ["foreign::", ""] {
        let item = CompletedModelItem {
            canonical_item_id: None,
            native: None,
            normalized: Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: "foreign".into(),
                name: "read".into(),
                raw_arguments_json: "{".into(),
                namespace: Some(namespace.into()),
            })),
        };
        let mut events = response(&[("prior", "read", "{}")]);
        events.pop();
        events.push(ModelStreamEvent::OutputItemDone(Box::new(item)));
        events.push(ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        });
        let (transport, sink, ids, request) = setup(vec![
            events,
            response(&[("corrected", "read", "{}")]),
            answer(),
        ]);
        let owner = GuardedTools::new();
        let tools = registry(&owner);
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
        assert_eq!(*owner.validated.lock().unwrap(), ["prior", "corrected"]);
        assert_eq!(*owner.executed.lock().unwrap(), ["prior", "corrected"]);
        assert_eq!(*owner.receipted.lock().unwrap(), ["prior", "corrected"]);
        let requests = transport.requests.lock().unwrap();
        assert!(requests[1].messages.iter().any(|message|matches!(message,ModelMessage::ToolResult{call_id,content,is_error:true}if call_id=="foreign"&&content.contains("unsupported_tool")&&!content.contains("invalid_tool_arguments"))));
        let replay = reconstruct_history(&sink.projection.lock().unwrap()).unwrap();
        assert!(replay.iter().any(|message|matches!(message,ModelMessage::CanonicalOutput(item)if matches!(&item.normalized,Some(ModelOutputItem::ToolCall(call))if call.namespace.as_deref()==Some(namespace)&&call.raw_arguments_json=="{"))));
    }
}

struct NoNamespaceRoute;
impl ToolExecutor for NoNamespaceRoute {
    fn resolve_name(&self, _: &str) -> ToolNameResolution {
        panic!("namespace must be checked before flat lookup")
    }
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        panic!("no validation")
    }
    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        panic!("no execution")
    }
    fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
        panic!("no receipt")
    }
}

#[tokio::test]
async fn namespace_rejection_precedes_lookup_and_json_parse_without_an_execution_receipt() {
    let (transport, sink, ids, request) = setup(vec![
        vec![
            begin(),
            ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
                canonical_item_id: None,
                native: None,
                normalized: Some(ModelOutputItem::ToolCall(ToolCallIntent {
                    call_id: "foreign".into(),
                    name: "read".into(),
                    raw_arguments_json: "{".into(),
                    namespace: Some(String::new()),
                })),
            })),
            ModelStreamEvent::Completed {
                reason: FinishReason::ToolCalls,
                end_turn: None,
            },
        ],
        answer(),
    ]);
    TurnRunner {
        transport: &transport,
        tools: &NoNamespaceRoute,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    assert!(reconstruct_history(&sink.projection.lock().unwrap()).is_ok());
}

#[tokio::test]
async fn registered_namespace_routes_the_done_intent_to_its_own_handler() {
    let call = |id: &str, namespace: Option<&str>| {
        ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
            canonical_item_id: None,
            native: None,
            normalized: Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: id.into(),
                name: "read".into(),
                raw_arguments_json: "{}".into(),
                namespace: namespace.map(str::to_owned),
            })),
        }))
    };
    let (transport, sink, ids, mut request) = setup(vec![
        vec![
            begin(),
            call("plain", None),
            call("qualified", Some("registered")),
            call("foreign", Some("foreign")),
            ModelStreamEvent::Completed {
                reason: FinishReason::ToolCalls,
                end_turn: None,
            },
        ],
        answer(),
    ]);
    request.tools.clear();
    let plain = GuardedTools::new();
    let qualified = GuardedTools::new();
    let definition = |namespace: Option<&str>| ToolDefinition {
        namespace: namespace.map(str::to_owned),
        name: "read".into(),
        description: "Read".into(),
        parameters: json!({"type":"object"}),
    };
    let tools = ToolRegistry::from_registrations([
        ToolRegistration::new(vec![definition(None)], &plain),
        ToolRegistration::new(vec![definition(Some("registered"))], &qualified),
    ])
    .unwrap();
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
    assert_eq!(*plain.executed.lock().unwrap(), ["plain"]);
    assert_eq!(*qualified.executed.lock().unwrap(), ["qualified"]);
    assert_eq!(*plain.receipted.lock().unwrap(), ["plain"]);
    assert_eq!(*qualified.receipted.lock().unwrap(), ["qualified"]);
    let history = reconstruct_history(&sink.projection.lock().unwrap()).unwrap();
    assert!(transport.requests.lock().unwrap()[1].messages.iter().any(|message| matches!(message, ModelMessage::ToolResult {call_id, is_error:true, ..} if call_id == "foreign")));
    assert!(history.iter().any(|message| matches!(message, ModelMessage::CanonicalOutput(item)
        if matches!(&item.normalized, Some(ModelOutputItem::ToolCall(call)) if call.name == "read" && call.namespace.as_deref() == Some("registered")))));
}

#[tokio::test]
async fn fatal_qualified_rejection_reports_only_the_exact_advertised_tool() {
    let item = ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
        canonical_item_id: None,
        native: None,
        normalized: Some(ModelOutputItem::ToolCall(ToolCallIntent {
            call_id: "denied".into(),
            name: "read".into(),
            namespace: Some("registered".into()),
            raw_arguments_json: "{\"deny\":true}".into(),
        })),
    }));
    let (transport, sink, ids, mut request) = setup(vec![vec![
        begin(),
        item,
        ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        },
    ]]);
    request.tools[0].namespace = Some("foreign".into());
    let owner = GuardedTools::new();
    let tools = ToolRegistry::from_registrations([ToolRegistration::new(
        vec![ToolDefinition {
            namespace: Some("registered".into()),
            name: "read".into(),
            description: "Read".into(),
            parameters: json!({"type":"object"}),
        }],
        &owner,
    )])
    .unwrap();
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    let Err(RunError::ToolRejectionDiagnostic(value)) = result else {
        panic!("expected validation diagnostic")
    };
    let diagnostic: serde_json::Value = serde_json::from_str(&value).unwrap();
    assert_eq!(diagnostic["advertised"], false);
    assert_eq!(diagnostic["toolNamespace"], "registered");
    assert_eq!(diagnostic["providerCallId"], "denied");
    assert!(!value.contains("\"deny\""));
    assert!(owner.executed.lock().unwrap().is_empty());
}
