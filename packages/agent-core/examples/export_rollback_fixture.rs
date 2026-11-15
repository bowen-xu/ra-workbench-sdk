//! Shared append-only rollback ledger, validated by the production projection.
use research_agent_core::{conversation::ConversationId, protocol::*};
use uuid::Uuid;

fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}

struct Fixture {
    projection: ConversationProjection,
    events: Vec<AgentEvent>,
}
impl Fixture {
    fn emit(&mut self, payload: EventPayload) {
        let event = AgentEvent::new(
            self.projection.conversation_id(),
            self.projection.seq() + 1,
            1_700_000_000_000 + self.projection.seq(),
            id(4),
            payload,
        )
        .unwrap();
        assert_eq!(self.projection.apply(&event).unwrap(), ApplyResult::Applied);
        self.events.push(event);
    }

    fn turn(&mut self, turn: u128, users: u128) {
        self.emit(EventPayload::TurnStarted {
            turn_id: id(turn),
            context_snapshot_id: id(turn + 100),
            model: ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "rollback".into(),
                revision: Some("1".into()),
            },
            task_kind: if users == 0 {
                TaskKind::Compact
            } else {
                TaskKind::Regular
            },
        });
        for user in 0..users {
            let item_id = id(turn * 1000 + user);
            self.emit(EventPayload::ItemStarted {
                turn_id: id(turn),
                item_id,
                kind: ItemKind::UserMessage,
            });
            self.emit(EventPayload::TextDelta {
                turn_id: id(turn),
                item_id,
                text: format!("User input {turn}/{}", user + 1),
            });
            self.emit(EventPayload::ItemCompleted {
                turn_id: id(turn),
                item_id,
            });
        }
        self.emit(EventPayload::TurnFinished {
            turn_id: id(turn),
            outcome: TurnOutcome::Completed,
        });
    }
}

fn main() {
    let mut fixture = Fixture {
        projection: ConversationProjection::new(ConversationId::from_uuid(id(1))),
        events: vec![],
    };
    fixture.turn(10, 1);
    fixture.turn(20, 0);
    fixture.turn(30, 2);
    fixture.turn(40, 0);
    let original = fixture.events.clone();
    fixture.emit(EventPayload::ConversationRolledBack {
        turn_id: id(40),
        user_turns: 1,
    });
    assert_eq!(fixture.projection.seq(), 18);
    assert_eq!(fixture.projection.turn_order(), &[id(10), id(20)]);
    assert!(fixture.projection.turn(id(30)).is_none());
    assert_eq!(fixture.projection.active_turn(), None);
    assert!(fixture.projection.turn_started_after(id(30), 0));
    assert!(
        fixture
            .projection
            .context_tail(5)
            .unwrap()
            .turn(id(30))
            .is_none()
    );
    assert_eq!(fixture.events[..original.len()], original);
    let marker = fixture.events.last().unwrap();
    assert_eq!(
        fixture.projection.apply(marker).unwrap(),
        ApplyResult::AlreadyApplied
    );

    fixture.emit(EventPayload::ConversationRolledBack {
        turn_id: id(20),
        user_turns: 1,
    });
    assert_eq!(fixture.projection.seq(), 19);
    assert!(fixture.projection.turn_order().is_empty());
    assert_eq!(fixture.projection.active_turn(), None);
    fixture.turn(50, 1);
    assert_eq!(fixture.projection.seq(), 24);
    assert_eq!(fixture.projection.turn_order(), &[id(50)]);
    assert_eq!(fixture.events[..original.len()], original);

    let encoded = serde_json::to_string_pretty(&fixture.events).unwrap();
    let decoded: Vec<AgentEvent> = serde_json::from_str(&encoded).unwrap();
    let mut replay = ConversationProjection::new(fixture.projection.conversation_id());
    for event in decoded {
        replay.apply(&event).unwrap();
    }
    assert_eq!(replay, fixture.projection);
    println!("{encoded}");
}
