use super::*;

#[test]
fn pure_image_user_restores_only_bound_content_and_missing_content_is_rejected() {
    use std::{collections::HashMap, sync::Arc};
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::UserMessage, "", true);
    h.end(TurnOutcome::Completed);
    assert!(matches!(
        reconstruct_history(&h.projection),
        Err(HistoryError::IncompleteInput)
    ));
    let item = h.projection.turn(h.turn).unwrap().item_order[0];
    let image = ContentPart::Image {
        media_type: "image/png".into(),
        bytes: Arc::from(&b"synthetic frozen bytes"[..]),
    };
    let messages = reconstruct_history_with_developer_context(
        &h.projection,
        &HashMap::new(),
        &HashMap::from([(item, vec![image.clone()])]),
        &HashMap::new(),
        &HashMap::new(),
        None,
    )
    .unwrap();
    assert!(
        messages
            == vec![ModelMessage::User {
                content: vec![image],
                source_item_id: Some(item)
            }]
    );
}

#[test]
fn stopped_hook_context_survives_an_empty_turn_and_precedes_later_input() {
    use std::collections::HashMap;
    let mut h = History::new();
    h.begin();
    let stopped = h.turn;
    h.end(TurnOutcome::Canceled);
    h.begin();
    h.item(ItemKind::UserMessage, "next input", true);
    h.end(TurnOutcome::Completed);
    let prefixes = HashMap::from([(stopped, vec!["  hook context\n正文".into(), "".into()])]);
    let messages = reconstruct_history_with_developer_context(
        &h.projection,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &prefixes,
        None,
    )
    .unwrap();
    assert!(
        messages
            == vec![
                ModelMessage::Developer("  hook context\n正文".into()),
                ModelMessage::Developer("".into()),
                ModelMessage::User {
                    content: vec![ContentPart::Text("next input".into())],
                    source_item_id: Some(Uuid::from_u128(h.next))
                },
            ]
    );
    assert!(
        reconstruct_history_with_developer_context(
            &h.projection,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::from([(Uuid::nil(), vec!["unbound".into()])]),
            None,
        )
        .is_err()
    );
}

#[test]
fn hook_prefix_precedes_surviving_same_turn_steering_after_checkpoint() {
    use std::collections::HashMap;
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::UserMessage, "covered input", true);
    h.item(ItemKind::AssistantMessage, "covered response", true);
    let watermark = h.projection.seq();
    h.item(ItemKind::UserMessage, "surviving steer", true);
    h.end(TurnOutcome::Completed);
    let messages = reconstruct_history_with_developer_context(
        &h.projection,
        &HashMap::from([(h.turn, vec![ContentPart::Text("covered context".into())])]),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::from([(h.turn, vec!["after compact".into()])]),
        Some(watermark),
    )
    .unwrap();
    assert!(
        messages
            == vec![
                ModelMessage::Developer("after compact".into()),
                ModelMessage::User {
                    content: vec![ContentPart::Text("surviving steer".into())],
                    source_item_id: Some(Uuid::from_u128(h.next))
                },
            ]
    );
}

#[test]
fn checkpoint_tail_excludes_covered_anchors_and_interruption_keeps_committed_policy() {
    use std::collections::HashMap;
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::AssistantMessage, "old", true);
    let old = Uuid::from_u128(h.next);
    h.end(TurnOutcome::Completed);
    let watermark = h.projection.seq();
    h.begin();
    h.item(ItemKind::AssistantMessage, "new", true);
    let anchor = Uuid::from_u128(h.next);
    h.item(
        ItemKind::ToolCall {
            call_id: Uuid::from_u128(100),
            name: "read".into(),
            provider_call_id: None,
            namespace: None,
        },
        "{",
        false,
    );
    h.end(TurnOutcome::Canceled);
    let fragments = HashMap::from([(anchor, vec!["committed hint".into()])]);
    let messages = reconstruct_history_with_developer_fragments(
        &h.projection,
        &HashMap::new(),
        &HashMap::new(),
        &fragments,
        Some(watermark),
    )
    .unwrap();
    assert_eq!(messages.len(), 2);
    assert!(
        matches!(&messages[0], ModelMessage::Assistant { content, tool_calls, .. } if tool_calls.is_empty() && matches!(&content[0], ContentPart::Text(text) if text.contains("omitted")))
    );
    assert!(messages[1] == ModelMessage::Developer("committed hint".into()));
    let covered = HashMap::from([(old, vec!["covered".into()])]);
    assert!(matches!(
        reconstruct_history_with_developer_fragments(
            &h.projection,
            &HashMap::new(),
            &HashMap::new(),
            &covered,
            Some(watermark)
        ),
        Err(HistoryError::InvalidOrder)
    ));
}

#[test]
fn trusted_fragments_preserve_anchors_and_cannot_split_a_tool_batch() {
    use std::collections::HashMap;
    let mut h = History::new();
    h.begin();
    h.item(ItemKind::UserMessage, "question", true);
    h.call(100);
    h.call(101);
    h.result(100);
    let early = Uuid::from_u128(h.next);
    h.result(101);
    let anchor = Uuid::from_u128(h.next);
    h.item(ItemKind::UserMessage, "steer", true);
    h.end(TurnOutcome::Completed);
    let fragments = HashMap::from([(anchor, vec!["remaining 0".into(), "prepare".into()])]);
    let messages = reconstruct_history_with_developer_fragments(
        &h.projection,
        &HashMap::new(),
        &HashMap::new(),
        &fragments,
        None,
    )
    .unwrap();
    let index = messages
        .iter()
        .position(|message| matches!(message, ModelMessage::Developer(_)))
        .unwrap();
    assert!(matches!(
        messages[index - 1],
        ModelMessage::ToolResult { .. }
    ));
    assert!(messages[index] == ModelMessage::Developer("remaining 0".into()));
    assert!(messages[index + 1] == ModelMessage::Developer("prepare".into()));
    assert!(
        messages[index + 2]
            == ModelMessage::User {
                content: vec![ContentPart::Text("steer".into())],
                source_item_id: Some(Uuid::from_u128(h.next))
            }
    );
    validate(messages);
    for bad in [early, Uuid::nil()] {
        let invalid = HashMap::from([(bad, vec!["unplaced".into()])]);
        assert!(matches!(
            reconstruct_history_with_developer_fragments(
                &h.projection,
                &HashMap::new(),
                &HashMap::new(),
                &invalid,
                None
            ),
            Err(HistoryError::InvalidOrder)
        ));
    }
}
