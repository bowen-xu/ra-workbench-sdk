use super::*;
use tokio::sync::oneshot;

struct Tools {
    receiver: Mutex<Option<oneshot::Receiver<()>>>,
    started: Mutex<Vec<String>>,
    terminal: Terminal,
}
#[derive(Clone, Copy)]
enum Terminal {
    Unknown,
    Canceled,
    Fatal,
}
impl ToolExecutor for Tools {
    fn supports_parallel(&self, _: &ToolCall) -> bool {
        true
    }
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.started.lock().unwrap().push(call.call_id.clone());
        if call.call_id == "first" {
            let receiver = self.receiver.lock().unwrap().take().unwrap();
            let terminal = self.terminal;
            Box::pin(async move {
                receiver.await.unwrap();
                match terminal {
                    Terminal::Canceled => Err(ModelError::Canceled.into()),
                    Terminal::Unknown => Err(RunError::ToolOutcomeUnknown),
                    Terminal::Fatal => Err(RunError::Budget),
                }
            })
        } else {
            Box::pin(async {
                Ok(ToolOutput {
                    content: "unexpected execution".into(),
                    is_error: false,
                })
            })
        }
    }
}
struct Transport {
    sender: Mutex<Option<oneshot::Sender<()>>>,
}
struct Stream {
    events: VecDeque<ModelStreamEvent>,
    sender: Option<oneshot::Sender<()>>,
}
impl ModelStream for Stream {
    fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
        Box::pin(async move {
            let event = self.events.pop_front();
            if matches!(&event, Some(ModelStreamEvent::ToolCallCompleted {call_id}) if call_id == "second")
            {
                self.sender.take().unwrap().send(()).unwrap();
            }
            Ok(event)
        })
    }
}
impl ModelTransport for Transport {
    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities {
            vision: true,
            tools: true,
            parallel_tools: true,
            reasoning_efforts: vec![],
        }
    }
    fn start(&self, _: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
        let mut events = vec![begin()];
        events.extend(call("first", "{}"));
        events.extend(call("second", "{}"));
        events.push(ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        });
        let sender = self.sender.lock().unwrap().take();
        Box::pin(async move {
            Ok(Box::new(Stream {
                events: events.into(),
                sender,
            }) as Box<dyn ModelStream>)
        })
    }
}
async fn scenario(terminal: Terminal) {
    let (_, sink, ids, request) = setup(vec![]);
    let (sender, receiver) = oneshot::channel();
    let tools = Tools {
        receiver: Mutex::new(Some(receiver)),
        started: Mutex::new(vec![]),
        terminal,
    };
    let transport = Transport {
        sender: Mutex::new(Some(sender)),
    };
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run(Uuid::from_u128(2), request),
    )
    .await
    .expect("owners must finish");
    match terminal {
        Terminal::Canceled => assert!(matches!(
            outcome,
            Err(RunError::Model(ModelError::Canceled))
        )),
        Terminal::Unknown => assert!(matches!(outcome, Err(RunError::ToolOutcomeUnknown))),
        Terminal::Fatal => assert!(matches!(outcome, Err(RunError::Budget))),
    }
    assert_eq!(*tools.started.lock().unwrap(), ["first"]);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    let second = turn
        .items
        .values()
        .find_map(|item| match &item.kind {
            ItemKind::ToolCall {
                call_id,
                provider_call_id: Some(id),
                ..
            } if id == "second" => Some(*call_id),
            _ => None,
        })
        .expect("second intent must remain durable");
    assert!(turn.items.values().any(|item| item.completed && item.text.contains("tool_not_started")
        && matches!(&item.kind,ItemKind::ToolResult {call_id,is_error:Some(true)} if *call_id==second)));
}
#[tokio::test]
async fn unknown_prevents_new_parallel_effect_and_keeps_unstarted_history() {
    scenario(Terminal::Unknown).await;
}
#[tokio::test]
async fn cancellation_prevents_new_parallel_effect_and_keeps_unstarted_history() {
    scenario(Terminal::Canceled).await;
}
#[tokio::test]
async fn fatal_prevents_new_parallel_effect_and_keeps_unstarted_history() {
    scenario(Terminal::Fatal).await;
}
