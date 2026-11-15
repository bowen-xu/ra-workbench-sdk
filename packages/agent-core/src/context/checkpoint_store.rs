//! Storage-neutral port for complete replacement windows. A task owner must
//! await installation to completion even when a cancellation or IPC waiter ends.
use super::checkpoint::ContextCheckpoint;
use std::{future::Future, pin::Pin};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckpointInstallation {
    Installed,
    AlreadyInstalled { active: bool },
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CheckpointStoreError {
    #[error("context checkpoint storage unavailable")]
    Unavailable,
    #[error("{0}")]
    PersistenceDiagnostic(crate::model::ContextPersistenceDiagnostic),
    #[error("context checkpoint is invalid or corrupt")]
    Invalid,
    #[error("context checkpoint history or active window changed")]
    Conflict,
    #[error("context checkpoint task is no longer active")]
    Inactive,
    #[error("context checkpoint installation canceled")]
    Canceled,
}
pub type CheckpointStoreFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, CheckpointStoreError>> + Send + 'a>>;

pub trait ContextCheckpointStore: Send + Sync {
    /// Consume before dispatch, like Codex's take_pending_session_start_source.
    /// Hosts without hooks have no pending work. An already-started hook is never
    /// replayed after a crash; installation and enqueue must commit together.
    fn take_pending_session_start(
        &self,
        _conversation_id: Uuid,
    ) -> CheckpointStoreFuture<'_, Option<ContextCheckpoint>> {
        Box::pin(async { Ok(None) })
    }
    fn read_active(
        &self,
        conversation_id: Uuid,
    ) -> CheckpointStoreFuture<'_, Option<ContextCheckpoint>>;
    fn install(
        &self,
        checkpoint: ContextCheckpoint,
    ) -> CheckpointStoreFuture<'_, CheckpointInstallation> {
        let expected_revision = checkpoint.source_watermark;
        self.install_at(checkpoint, expected_revision)
    }
    /// Coverage and CAS revision differ when fresh input or lifecycle events
    /// follow the frozen history. Those later entries remain in the replay tail.
    fn install_at(
        &self,
        checkpoint: ContextCheckpoint,
        expected_revision: u64,
    ) -> CheckpointStoreFuture<'_, CheckpointInstallation>;
}
