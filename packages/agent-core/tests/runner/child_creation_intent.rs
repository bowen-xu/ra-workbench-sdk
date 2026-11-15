use super::*;
use research_agent_core::conversation::{
    BindingKind, ConversationBinding, CreateBoundConversation,
};

struct CreatingTool<'a> {
    sink: &'a Sink,
    starts: AtomicUsize,
    intent: CreateBoundConversation,
}

impl ToolExecutor for CreatingTool<'_> {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }

    fn child_creation_intent(&self, _: &ToolCall) -> Option<CreateBoundConversation> {
        Some(self.intent.clone())
    }

    fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            let projection = self.sink.projection.lock().unwrap();
            let turn = projection.turn(Uuid::from_u128(2)).unwrap();
            assert_eq!(
                turn.child_creation_intents.values().next(),
                Some(&self.intent)
            );
            assert_eq!(
                turn.child_submission_requests.values().next(),
                Some(
                    &research_agent_core::conversation::child_submission_request_id(
                        *self.intent.id.as_uuid()
                    )
                )
            );
            self.starts.fetch_add(1, Ordering::SeqCst);
            Ok(ToolOutput {
                content: "created".into(),
                is_error: false,
            })
        })
    }
}

struct RejectPrepared<'a>(&'a Sink);

impl TurnEventSink for RejectPrepared<'_> {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            if matches!(payload, EventPayload::ChildCreationPrepared { .. }) {
                return Err(RunError::EventSink);
            }
            self.0.emit(payload).await
        })
    }
}

fn fixture() -> (Vec<ModelStreamEvent>, CreateBoundConversation) {
    let mut events = vec![
        begin(),
        ModelStreamEvent::ToolCallStarted {
            call_id: "child-call".into(),
            name: "research_spawn_subtask".into(),
        },
    ];
    events.push(ModelStreamEvent::ToolArgumentsDelta {
        call_id: "child-call".into(),
        delta: "{}".into(),
    });
    events.push(ModelStreamEvent::ToolCallCompleted {
        call_id: "child-call".into(),
    });
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let intent = CreateBoundConversation {
        operation_id: Uuid::from_u128(21),
        id: ConversationId::from_uuid(Uuid::from_u128(22)),
        binding: ConversationBinding {
            kind: BindingKind::Paper,
            resource_id: " original paper ".into(),
        },
    };
    (events, intent)
}

#[tokio::test]
async fn intent_is_durable_before_child_creation_and_failure_prevents_execution() {
    for reject in [false, true] {
        let (events, intent) = fixture();
        let (transport, sink, ids, mut request) = setup(vec![events, answer()]);
        request.tools[0].name = "research_spawn_subtask".into();
        let tool = CreatingTool {
            sink: &sink,
            starts: AtomicUsize::new(0),
            intent,
        };
        let rejecting = RejectPrepared(&sink);
        let event_sink: &dyn TurnEventSink = if reject { &rejecting } else { &sink };
        let result = TurnRunner {
            transport: &transport,
            tools: &tool,
            sink: event_sink,
            ids: &ids,
            limits: limits(),
        }
        .run(Uuid::from_u128(2), request)
        .await;
        if reject {
            assert!(matches!(result, Err(RunError::EventSink)));
            assert_eq!(tool.starts.load(Ordering::SeqCst), 0);
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
        } else {
            result.unwrap();
            assert_eq!(tool.starts.load(Ordering::SeqCst), 1);
        }
    }
}
