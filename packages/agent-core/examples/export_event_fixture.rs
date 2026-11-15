use research_agent_core::{conversation::ConversationId, protocol::*};
use uuid::Uuid;

fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}

fn main() {
    let turn_id = id(2);
    let call_id = id(5);
    let payloads = vec![
        EventPayload::TurnStarted {
            task_kind: research_agent_core::protocol::TaskKind::Regular,
            turn_id,
            context_snapshot_id: id(3),
            model: ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "agent-test".into(),
                revision: Some("1".into()),
            },
        },
        EventPayload::ItemStarted {
            turn_id,
            item_id: id(10),
            kind: ItemKind::UserMessage,
        },
        EventPayload::TextDelta {
            turn_id,
            item_id: id(10),
            text: "请检查稿件".into(),
        },
        EventPayload::ItemCompleted {
            turn_id,
            item_id: id(10),
        },
        EventPayload::PhaseChanged {
            turn_id,
            phase: TurnPhase::RunningModel,
        },
        EventPayload::ModelRequestStarted {
            turn_id,
            attempt_id: id(50),
            model: ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "agent-test".into(),
                revision: None,
            },
        },
        EventPayload::ModelResponseStarted {
            turn_id,
            attempt_id: id(50),
            response_id: "response-1".into(),
            model: Some(ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "agent-test-actual".into(),
                revision: Some("2".into()),
            }),
        },
        EventPayload::ModelRequestFinished {
            turn_id,
            attempt_id: id(50),
            input_tokens: Some(5),
            output_tokens: Some(2),
        },
        EventPayload::ItemStarted {
            turn_id,
            item_id: id(11),
            kind: ItemKind::ToolCall {
                call_id,
                name: "manuscript.read".into(),
                provider_call_id: Some("provider-call-1".into()),
                namespace: None,
            },
        },
        EventPayload::TextDelta {
            turn_id,
            item_id: id(11),
            text: "{}".into(),
        },
        EventPayload::ItemCompleted {
            turn_id,
            item_id: id(11),
        },
        EventPayload::PhaseChanged {
            turn_id,
            phase: TurnPhase::RunningTools,
        },
        EventPayload::ItemStarted {
            turn_id,
            item_id: id(12),
            kind: ItemKind::ToolResult {
                call_id,
                is_error: Some(false),
            },
        },
        EventPayload::TextDelta {
            turn_id,
            item_id: id(12),
            text: "公开测试稿件".into(),
        },
        EventPayload::ItemCompleted {
            turn_id,
            item_id: id(12),
        },
        EventPayload::PhaseChanged {
            turn_id,
            phase: TurnPhase::RunningModel,
        },
        EventPayload::ItemStarted {
            turn_id,
            item_id: id(13),
            kind: ItemKind::AssistantMessage,
        },
        EventPayload::TextDelta {
            turn_id,
            item_id: id(13),
            text: "检查完成。".into(),
        },
        EventPayload::ItemPhaseChanged {
            turn_id,
            item_id: id(13),
            phase: AssistantMessagePhase::FinalAnswer,
            native: true,
        },
        EventPayload::ItemCompleted {
            turn_id,
            item_id: id(13),
        },
        EventPayload::ModelOutputOrder {
            turn_id,
            item_ids: vec![id(13)],
        },
        EventPayload::Usage {
            turn_id,
            input_tokens: Some(120),
            output_tokens: Some(30),
        },
        EventPayload::ModelRequestStarted {
            turn_id,
            attempt_id: id(51),
            model: ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "agent-test".into(),
                revision: None,
            },
        },
        EventPayload::ModelCompactionFinished {
            turn_id,
            attempt_id: id(51),
            input_tokens: None,
            output_tokens: None,
        },
        EventPayload::TurnFinished {
            turn_id,
            outcome: TurnOutcome::Completed,
        },
        EventPayload::TurnStarted {
            task_kind: TaskKind::Regular,
            turn_id: id(60),
            context_snapshot_id: id(61),
            model: ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "agent-test".into(),
                revision: None,
            },
        },
        EventPayload::TurnFailed {
            turn_id: id(60),
            error: "run budget exhausted".into(),
            category: FailureCategory::Admission,
        },
        EventPayload::TurnFinished {
            turn_id: id(60),
            outcome: TurnOutcome::Failed,
        },
    ];
    let events = payloads
        .into_iter()
        .enumerate()
        .map(|(index, payload)| {
            AgentEvent::new(
                ConversationId::from_uuid(id(1)),
                index as u64 + 1,
                1_700_000_000_000 + index as u64,
                id(4),
                payload,
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    println!("{}", serde_json::to_string_pretty(&events).unwrap());
}
