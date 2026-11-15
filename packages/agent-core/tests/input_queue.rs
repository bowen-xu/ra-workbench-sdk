use research_agent_core::input_queue::{InputQueue, QueueEdit, QueueError, QueuedInput};
use uuid::Uuid;

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

#[test]
fn entry_origin_survives_text_edits_preparation_release_and_restore() {
    use research_agent_core::conversation::{BindingKind, ConversationBinding};
    let origin = ConversationBinding {
        kind: BindingKind::ReadingNote,
        resource_id: id(7).to_string(),
    };
    let queue = InputQueue::new(id(100))
        .unwrap()
        .apply(
            0,
            QueueEdit::Add(QueuedInput {
                user_input: vec![],
                id: id(1),
                text: "original".into(),
                origin: Some(origin.clone()),
            }),
        )
        .unwrap()
        .apply(
            1,
            QueueEdit::Update {
                user_input: vec![],
                id: id(1),
                text: "edited elsewhere".into(),
            },
        )
        .unwrap()
        .apply(2, QueueEdit::Prepare(id(1)))
        .unwrap()
        .apply(3, QueueEdit::Release(id(1)))
        .unwrap();
    let restored = InputQueue::restore(
        id(100),
        queue.revision(),
        queue.paused(),
        queue.inputs().to_vec(),
        queue.preparing(),
    )
    .unwrap();
    assert_eq!(restored.inputs()[0].origin, Some(origin));
    assert_eq!(restored.inputs()[0].text, "edited elsewhere");
    assert!(restored.paused());
}

#[test]
fn origin_is_typed_non_nil_resource_identity_and_cannot_carry_execution_fields() {
    use research_agent_core::conversation::{BindingKind, ConversationBinding};
    for resource_id in ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000"] {
        assert_eq!(
            InputQueue::new(id(100)).unwrap().apply(
                0,
                QueueEdit::Add(QueuedInput {
                    user_input: vec![],
                    id: id(1),
                    text: "text".into(),
                    origin: Some(ConversationBinding {
                        kind: BindingKind::Note,
                        resource_id: resource_id.into()
                    }),
                })
            ),
            Err(QueueError::Invalid)
        );
    }
    assert!(
        serde_json::from_value::<ConversationBinding>(
            serde_json::json!({"kind":"note","resourceId":id(1),"permissions":["shell"]})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<ConversationBinding>(
            serde_json::json!({"kind":"unknown","resourceId":id(1)})
        )
        .is_err()
    );
}

#[test]
fn restore_rejects_invalid_head_duplicates_and_invalid_text() {
    let input = QueuedInput {
        user_input: vec![],
        origin: None,
        id: id(1),
        text: "saved".into(),
    };
    assert!(InputQueue::restore(id(100), 8, false, vec![input.clone()], Some(id(2))).is_err());
    assert!(
        InputQueue::restore(id(100), 8, false, vec![input.clone(), input.clone()], None).is_err()
    );
    assert!(InputQueue::restore(id(100), 8, false, vec![], Some(id(1))).is_err());
    let restored = InputQueue::restore(id(100), 8, true, vec![input], Some(id(1))).unwrap();
    assert_eq!(restored.revision(), 8);
    assert_eq!(restored.preparing(), Some(id(1)));
    assert!(restored.paused());
    assert!(
        InputQueue::restore(
            id(100),
            8,
            false,
            vec![QueuedInput {
                user_input: vec![],
                origin: None,
                id: id(1),
                text: "".into()
            }],
            None
        )
        .is_err()
    );
}
fn add(queue: &InputQueue, n: u128) -> InputQueue {
    queue
        .apply(
            queue.revision(),
            QueueEdit::Add(QueuedInput {
                user_input: vec![],
                origin: None,
                id: id(n),
                text: format!("input {n}"),
            }),
        )
        .unwrap()
}

#[test]
fn edits_preserve_order_and_reject_stale_views_without_mutation() {
    let queue = add(&add(&InputQueue::new(id(100)).unwrap(), 1), 2);
    let edited = queue
        .apply(
            2,
            QueueEdit::Update {
                user_input: vec![],
                id: id(1),
                text: "changed".into(),
            },
        )
        .unwrap();
    assert_eq!(edited.inputs()[0].text, "changed");
    assert_eq!(queue.inputs()[0].text, "input 1");
    assert_eq!(
        edited.apply(2, QueueEdit::Remove(id(1))),
        Err(QueueError::Conflict)
    );
    let reordered = edited
        .apply(3, QueueEdit::Reorder(vec![id(2), id(1)]))
        .unwrap();
    let removed = reordered.apply(4, QueueEdit::Remove(id(2))).unwrap();
    assert_eq!(removed.inputs()[0].id, id(1));
    assert_eq!(removed.conversation_id(), id(100));
}

#[test]
fn reorder_requires_exact_permutation_and_duplicate_ids_cannot_replace_text() {
    let queue = add(&add(&InputQueue::new(id(100)).unwrap(), 1), 2);
    for order in [vec![id(1)], vec![id(1), id(1)], vec![id(1), id(3)]] {
        assert!(queue.apply(2, QueueEdit::Reorder(order)).is_err());
    }
    assert_eq!(
        queue.apply(
            2,
            QueueEdit::Add(QueuedInput {
                user_input: vec![],
                origin: None,
                id: id(1),
                text: "replacement".into()
            })
        ),
        Err(QueueError::Conflict)
    );
    assert_eq!(queue.inputs()[0].text, "input 1");
}

#[test]
fn preparation_locks_head_and_failed_preparation_retains_input_until_resume() {
    let queue = add(&add(&InputQueue::new(id(100)).unwrap(), 1), 2);
    assert_eq!(
        queue.apply(2, QueueEdit::Prepare(id(2))),
        Err(QueueError::Conflict)
    );
    let claimed = queue.apply(2, QueueEdit::Prepare(id(1))).unwrap();
    assert_eq!(claimed.apply(3, QueueEdit::Resume), Err(QueueError::Busy));
    for edit in [
        QueueEdit::Remove(id(1)),
        QueueEdit::Update {
            user_input: vec![],
            id: id(1),
            text: "late".into(),
        },
        QueueEdit::Reorder(vec![id(2), id(1)]),
        QueueEdit::Prepare(id(2)),
    ] {
        assert_eq!(claimed.apply(3, edit), Err(QueueError::Busy));
    }
    let tail_edited = claimed
        .apply(
            3,
            QueueEdit::Update {
                user_input: vec![],
                id: id(2),
                text: "tail".into(),
            },
        )
        .unwrap();
    let released = tail_edited.apply(4, QueueEdit::Release(id(1))).unwrap();
    assert_eq!(released.inputs().len(), 2);
    assert!(released.paused());
    assert_eq!(
        released.apply(5, QueueEdit::Prepare(id(1))),
        Err(QueueError::Paused)
    );
    let resumed = released.apply(5, QueueEdit::Resume).unwrap();
    let claimed = resumed.apply(6, QueueEdit::Prepare(id(1))).unwrap();
    assert_eq!(
        claimed.apply(7, QueueEdit::Admitted(id(2))),
        Err(QueueError::Conflict)
    );
    let admitted = claimed.apply(7, QueueEdit::Admitted(id(1))).unwrap();
    assert_eq!(admitted.inputs()[0].text, "tail");
    assert_eq!(admitted.preparing(), None);
}

#[test]
fn pause_preserves_claim_and_remaining_inputs_after_admission() {
    let queue = add(&add(&InputQueue::new(id(100)).unwrap(), 1), 2);
    let queue = queue.apply(2, QueueEdit::Prepare(id(1))).unwrap();
    let queue = queue.apply(3, QueueEdit::Pause).unwrap();
    assert_eq!(queue.preparing(), Some(id(1)));
    let queue = queue.apply(4, QueueEdit::Admitted(id(1))).unwrap();
    assert!(queue.paused());
    assert_eq!(
        queue.apply(5, QueueEdit::Prepare(id(2))),
        Err(QueueError::Paused)
    );
}

#[test]
fn validates_utf8_byte_budget_identity_and_capacity() {
    assert_eq!(InputQueue::new(Uuid::nil()), Err(QueueError::Invalid));
    let mut queue = InputQueue::new(id(100)).unwrap();
    for text in [" ".into(), "中".repeat(21_846)] {
        assert_eq!(
            queue.apply(
                0,
                QueueEdit::Add(QueuedInput {
                    user_input: vec![],
                    origin: None,
                    id: id(1),
                    text
                })
            ),
            Err(QueueError::Invalid)
        );
    }
    for n in 1..=64 {
        queue = add(&queue, n);
    }
    assert_eq!(
        queue.apply(
            64,
            QueueEdit::Add(QueuedInput {
                user_input: vec![],
                origin: None,
                id: id(65),
                text: "full".into()
            })
        ),
        Err(QueueError::Capacity)
    );
    assert_eq!(queue.inputs().len(), 64);
}

#[test]
fn individual_pause_skips_entries_and_admission_removes_only_the_claimed_entry() {
    let mut queue = InputQueue::new(id(100)).unwrap();
    for n in 1..=3 {
        queue = queue
            .apply(
                queue.revision(),
                QueueEdit::Add(QueuedInput {
                    id: id(n),
                    text: format!("message {n}"),
                    user_input: vec![],
                    origin: None,
                }),
            )
            .unwrap();
    }
    queue = queue
        .apply(queue.revision(), QueueEdit::PauseInput(id(1)))
        .unwrap();
    assert!(!queue.paused());
    assert_eq!(queue.next_input().unwrap().id, id(2));
    assert_eq!(
        queue.apply(queue.revision(), QueueEdit::Prepare(id(1))),
        Err(QueueError::Paused)
    );
    queue = queue
        .apply(queue.revision(), QueueEdit::Prepare(id(2)))
        .unwrap();
    assert_eq!(
        queue.apply(queue.revision(), QueueEdit::PauseInput(id(2))),
        Err(QueueError::Busy)
    );
    assert_eq!(
        queue.apply(queue.revision(), QueueEdit::ResumeInput(id(1))),
        Err(QueueError::Busy)
    );
    // Other waiting messages can still be paused while one entry is preparing.
    queue = queue
        .apply(queue.revision(), QueueEdit::PauseInput(id(3)))
        .unwrap();
    queue = queue
        .apply(queue.revision(), QueueEdit::Admitted(id(2)))
        .unwrap();
    assert_eq!(
        queue
            .inputs()
            .iter()
            .map(|input| input.id)
            .collect::<Vec<_>>(),
        vec![id(1), id(3)]
    );
    assert!(queue.next_input().is_none());
    queue = queue
        .apply(queue.revision(), QueueEdit::ResumeInput(id(3)))
        .unwrap();
    assert_eq!(queue.next_input().unwrap().id, id(3));
    assert!(queue.input_paused(id(1)));
}

#[test]
fn paused_identity_survives_edit_reorder_restore_and_single_resume_after_stop() {
    let mut queue = InputQueue::new(id(100)).unwrap();
    for n in 1..=2 {
        queue = queue
            .apply(
                queue.revision(),
                QueueEdit::Add(QueuedInput {
                    id: id(n),
                    text: format!("message {n}"),
                    user_input: vec![],
                    origin: None,
                }),
            )
            .unwrap();
    }
    queue = queue
        .apply(queue.revision(), QueueEdit::PauseInput(id(1)))
        .unwrap();
    queue = queue
        .apply(
            queue.revision(),
            QueueEdit::Update {
                id: id(1),
                text: "edited".into(),
                user_input: vec![],
            },
        )
        .unwrap();
    queue = queue
        .apply(queue.revision(), QueueEdit::Reorder(vec![id(2), id(1)]))
        .unwrap();
    let restored = InputQueue::restore_with_paused_inputs(
        id(100),
        queue.revision(),
        false,
        queue.inputs().to_vec(),
        None,
        vec![id(1)],
    )
    .unwrap();
    assert_eq!(restored, queue);
    assert_eq!(
        queue.apply(queue.revision() - 1, QueueEdit::ResumeInput(id(1))),
        Err(QueueError::Conflict)
    );
    queue = queue.apply(queue.revision(), QueueEdit::Pause).unwrap();
    queue = queue
        .apply(queue.revision(), QueueEdit::ResumeInput(id(1)))
        .unwrap();
    assert!(!queue.paused());
    assert!(queue.input_paused(id(2)));
    assert_eq!(queue.next_input().unwrap().id, id(1));
    assert!(
        InputQueue::restore_with_paused_inputs(
            id(100),
            0,
            false,
            queue.inputs().to_vec(),
            None,
            vec![id(7)]
        )
        .is_err()
    );
    assert!(
        InputQueue::restore_with_paused_inputs(
            id(100),
            0,
            false,
            queue.inputs().to_vec(),
            None,
            vec![id(1), id(1)]
        )
        .is_err()
    );
}
