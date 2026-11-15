mod support;

use research_agent_core::conversation::{
    ConversationId, ConversationStore, HistoryQuery, LiveConversation, StoreError, WriterId,
    WriterLease,
};
use std::sync::{Arc, atomic::Ordering};
use support::TestStore;
use uuid::Uuid;

fn lease(conversation: u128, writer: u128) -> WriterLease {
    WriterLease {
        conversation_id: ConversationId::from_uuid(Uuid::from_u128(conversation)),
        writer_id: WriterId::from_uuid(Uuid::from_u128(writer)),
    }
}

fn page(lease: WriterLease, offset: u64, limit: u16) -> HistoryQuery {
    HistoryQuery::new(lease.conversation_id, offset, limit).unwrap()
}

#[tokio::test]
async fn pending_items_are_not_history_until_persisted_and_discard_keeps_durable_prefix() {
    let store = Arc::new(TestStore::default());
    let id = lease(1, 1);
    let live = LiveConversation::create(store.clone(), id).await.unwrap();
    live.append(&["user".into(), "assistant".into()])
        .await
        .unwrap();
    assert_eq!(
        store.history(page(id, 0, 20)).await,
        Err(StoreError::NotFound {
            conversation_id: id.conversation_id
        })
    );
    assert_eq!(live.persist().await.unwrap(), 2);
    live.append(&["unconfirmed tail".into()]).await.unwrap();
    live.discard();
    let history = store.history(page(id, 0, 20)).await.unwrap();
    assert_eq!(history.items, ["user", "assistant"]);
    assert_eq!(history.durable_count, 2);
    assert!(!store.has_writer(id));
}

#[tokio::test]
async fn empty_append_is_not_a_persistence_batch() {
    let store = Arc::new(TestStore::default());
    let live = LiveConversation::create(store.clone(), lease(1, 1))
        .await
        .unwrap();
    live.append(&[]).await.unwrap();
    assert_eq!(store.append_calls(), 0);
}

#[tokio::test]
async fn failed_open_discards_reserved_writer_without_materializing_a_conversation() {
    let store = Arc::new(TestStore::default());
    let id = lease(1, 1);
    store
        .fail_create_after_reservation
        .store(true, Ordering::SeqCst);
    assert!(matches!(
        LiveConversation::create(store.clone(), id).await,
        Err(StoreError::Unavailable)
    ));
    assert!(!store.has_writer(id));
    assert!(matches!(
        store.history(page(id, 0, 20)).await,
        Err(StoreError::NotFound { .. })
    ));
    assert!(LiveConversation::create(store, lease(1, 2)).await.is_ok());
}

#[tokio::test]
async fn canceled_initialization_releases_writer_without_an_async_drop_task() {
    let store = Arc::new(TestStore::default());
    let unblock = store.pause_next_create();
    let id = lease(1, 1);
    let task_store = store.clone();
    let task = tokio::spawn(async move { LiveConversation::create(task_store, id).await });
    store.create_reserved.notified().await;
    assert!(store.has_writer(id));
    task.abort();
    assert!(task.await.is_err());
    assert!(!store.has_writer(id));
    assert!(unblock.send(()).is_err());
    assert!(LiveConversation::create(store, lease(1, 2)).await.is_ok());
}

#[tokio::test]
async fn resume_history_failure_releases_writer_and_preserves_saved_data() {
    let store = Arc::new(TestStore::default());
    let live = LiveConversation::create(store.clone(), lease(1, 1))
        .await
        .unwrap();
    live.append(&["saved".into()]).await.unwrap();
    assert!(live.shutdown().await.is_ok());
    let next = lease(1, 2);
    store.fail_history.store(true, Ordering::SeqCst);
    assert!(matches!(
        LiveConversation::resume(store.clone(), next, 20).await,
        Err(StoreError::CorruptHistory)
    ));
    assert!(!store.has_writer(next));
    let (_, history) = LiveConversation::resume(store, lease(1, 3), 20)
        .await
        .unwrap();
    assert_eq!(history.items, ["saved"]);
}

#[tokio::test]
async fn failed_flush_retains_batch_and_retry_does_not_duplicate_items() {
    let store = Arc::new(TestStore::default());
    let id = lease(1, 1);
    let live = LiveConversation::create(store.clone(), id).await.unwrap();
    live.append(&["one".into(), "two".into()]).await.unwrap();
    store.fail_flush.store(true, Ordering::SeqCst);
    assert_eq!(live.flush().await, Err(StoreError::Unavailable));
    assert_eq!(live.flush().await.unwrap(), 2);
    assert_eq!(live.flush().await.unwrap(), 2);
    assert_eq!(
        store.history(page(id, 0, 20)).await.unwrap().items,
        ["one", "two"]
    );
}

#[tokio::test]
async fn failed_shutdown_returns_live_owner_for_explicit_retry() {
    let store = Arc::new(TestStore::default());
    let id = lease(1, 1);
    let live = LiveConversation::create(store.clone(), id).await.unwrap();
    live.append(&["pending".into()]).await.unwrap();
    store.fail_flush.store(true, Ordering::SeqCst);
    let (live, error) = live.shutdown().await.err().unwrap();
    assert_eq!(error, StoreError::Unavailable);
    assert!(store.has_writer(id));
    assert!(matches!(live.shutdown().await, Ok(1)));
    assert!(!store.has_writer(id));
    assert_eq!(
        store.history(page(id, 0, 20)).await.unwrap().items,
        ["pending"]
    );
}

#[tokio::test]
async fn stale_drop_and_competing_open_cannot_close_the_current_writer() {
    let store = Arc::new(TestStore::default());
    let first = LiveConversation::create(store.clone(), lease(1, 1))
        .await
        .unwrap();
    first.persist().await.unwrap();
    store.discard(first.lease());
    let current_id = lease(1, 2);
    let (current, _) = LiveConversation::resume(store.clone(), current_id, 20)
        .await
        .unwrap();
    drop(first);
    assert!(matches!(
        LiveConversation::resume(store.clone(), lease(1, 3), 20).await,
        Err(StoreError::WriterConflict)
    ));
    assert!(store.has_writer(current_id));
    current.append(&["current".into()]).await.unwrap();
    assert_eq!(current.flush().await.unwrap(), 1);
}

#[tokio::test]
async fn history_pages_have_stable_ordinals_and_conversations_are_isolated() {
    let store = Arc::new(TestStore::default());
    let a = LiveConversation::create(store.clone(), lease(1, 1))
        .await
        .unwrap();
    let b = LiveConversation::create(store.clone(), lease(2, 2))
        .await
        .unwrap();
    a.append(&["a1".into(), "a2".into(), "a3".into()])
        .await
        .unwrap();
    b.append(&["b1".into()]).await.unwrap();
    a.flush().await.unwrap();
    b.flush().await.unwrap();
    let first = store.history(page(a.lease(), 0, 2)).await.unwrap();
    assert_eq!(first.items, ["a1", "a2"]);
    assert_eq!(first.next_offset, Some(2));
    let last = store
        .history(page(a.lease(), first.next_offset.unwrap(), 2))
        .await
        .unwrap();
    assert_eq!(last.items, ["a3"]);
    assert_eq!(last.next_offset, None);
    assert_eq!(
        store.history(page(b.lease(), 0, 2)).await.unwrap().items,
        ["b1"]
    );
}

#[test]
fn ids_are_uuid_values_and_page_limits_are_bounded() {
    assert!(serde_json::from_str::<ConversationId>("\"not-an-id\"").is_err());
    let id = lease(1, 1).conversation_id;
    assert_eq!(
        serde_json::from_str::<ConversationId>(&serde_json::to_string(&id).unwrap()).unwrap(),
        id
    );
    assert!(HistoryQuery::new(id, 0, 0).is_err());
    assert!(HistoryQuery::new(id, 0, 501).is_err());
}

#[tokio::test]
async fn duplicate_open_id_does_not_discard_the_incumbent_writer() {
    let store = Arc::new(TestStore::default());
    let id = lease(1, 1);
    let live = LiveConversation::create(store.clone(), id).await.unwrap();
    assert!(matches!(
        LiveConversation::create(store.clone(), id).await,
        Err(StoreError::WriterConflict)
    ));
    assert!(store.has_writer(id));
    live.append(&["original owner".into()]).await.unwrap();
    assert_eq!(live.flush().await.unwrap(), 1);
}
