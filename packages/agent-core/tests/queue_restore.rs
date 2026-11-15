use research_agent_core::input_queue::{InputQueue, QueueEdit, QueueError, QueuedInput};
use uuid::Uuid;
fn item(n: u128) -> QueuedInput {
    QueuedInput {
        id: Uuid::from_u128(n),
        text: format!("input {n}"),
        user_input: vec![],
        origin: None,
    }
}

#[test]
fn atomic_restore_inserts_once_and_preserves_pause_without_mutating_rejected_queues() {
    let queue = InputQueue::new(Uuid::from_u128(100))
        .unwrap()
        .apply(0, QueueEdit::Add(item(1)))
        .unwrap();
    let restore = QueueEdit::Restore {
        input: item(3),
        source_id: Uuid::from_u128(2),
        index: 0,
        paused: true,
    };
    let restored = queue.apply(1, restore.clone()).unwrap();
    assert_eq!(
        restored
            .inputs()
            .iter()
            .map(|input| input.id)
            .collect::<Vec<_>>(),
        vec![Uuid::from_u128(3), Uuid::from_u128(1)]
    );
    assert!(restored.input_paused(Uuid::from_u128(3)));
    assert_eq!(restored.next_input().unwrap().id, Uuid::from_u128(1));
    assert_eq!(
        restored.apply(1, restore.clone()),
        Err(QueueError::Conflict)
    );
    assert_eq!(
        restored.apply(2, restore.clone()),
        Err(QueueError::Conflict)
    );
    let preparing = queue
        .apply(1, QueueEdit::Prepare(Uuid::from_u128(1)))
        .unwrap();
    assert_eq!(preparing.apply(2, restore), Err(QueueError::Busy));
    assert_eq!(preparing.inputs(), queue.inputs());
    let append = queue
        .apply(
            1,
            QueueEdit::Restore {
                input: item(4),
                source_id: Uuid::from_u128(2),
                index: 64,
                paused: false,
            },
        )
        .unwrap();
    assert_eq!(append.inputs().last().unwrap().id, Uuid::from_u128(4));
    assert_eq!(
        queue.apply(
            1,
            QueueEdit::Restore {
                input: item(4),
                source_id: Uuid::from_u128(1),
                index: 0,
                paused: false
            }
        ),
        Err(QueueError::Conflict)
    );
    assert_eq!(
        queue.apply(
            1,
            QueueEdit::Restore {
                input: item(4),
                source_id: Uuid::from_u128(2),
                index: 65,
                paused: false
            }
        ),
        Err(QueueError::Invalid)
    );
}
