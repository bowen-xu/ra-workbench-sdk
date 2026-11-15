//! Explicit physical deletion after history, provenance and execution ownership checks.
use super::{
    CatalogDataFailure, CatalogError, CatalogMutationFuture, CatalogMutationStatus,
    ConversationBinding, ConversationId,
};
use std::{future::Future, pin::Pin};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct ConversationDeletionRequest {
    pub request_id: Uuid,
    pub conversation_id: ConversationId,
    /// None confirms deletion from the application-wide catalog; it grants no execution rights.
    pub binding: Option<ConversationBinding>,
    pub expected_title: String,
    pub expected_durable_count: u64,
    /// Explicitly purge retained provenance and execution records. This is a
    /// separate destructive action from ordinary deletion and is only accepted
    /// for an archived conversation.
    pub force: bool,
}
impl ConversationDeletionRequest {
    /// Check the confirmation before acquiring or releasing any runtime owner.
    pub fn validate(&self) -> Result<(), CatalogError> {
        if self.request_id.is_nil()
            || self.conversation_id.as_uuid().is_nil()
            || self.expected_title.trim().is_empty()
            || self.expected_title.chars().count() > 180
            || self.expected_title.contains('\0')
            || self.expected_durable_count > 9_007_199_254_740_991
            || self.binding.as_ref().is_some_and(|binding| {
                binding.resource_id.trim().is_empty()
                    || binding.resource_id.chars().count() > 256
                    || binding.resource_id.contains('\0')
            })
        {
            return Err(CatalogError::InvalidInput);
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationDeletionReceipt {
    pub request_id: Uuid,
    pub conversation_id: ConversationId,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConversationRetention {
    BranchHistory,
    ProposalApplications,
    ExecutionWorkspace,
}
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConversationDeletionError {
    #[error(transparent)]
    Catalog(#[from] CatalogError),
    #[error(transparent)]
    Data(#[from] CatalogDataFailure),
    #[error("only archived conversations may be physically deleted")]
    NotArchived,
    #[error("conversation history is retained by {0:?}")]
    Retained(ConversationRetention),
}
pub type ConversationDeletionFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<ConversationDeletionReceipt, ConversationDeletionError>>
            + Send
            + 'a,
    >,
>;
pub trait ConversationDeletionStore: Send + Sync {
    /// Delete an archived, validated terminal history matching the confirmation.
    /// Ordinary deletion retains referenced provenance and execution copies;
    /// explicit force deletion purges those records. Exact retries return the
    /// original receipt; deleted IDs can never be recreated by a stale writer.
    fn delete(&self, request: ConversationDeletionRequest) -> ConversationDeletionFuture<'_>;
    /// Pin the original data owner before replay, workspace cleanup and SQL.
    /// Unsupported adapters must reject rather than invoke an unfenced delete.
    fn delete_in_epoch(
        &self,
        request: ConversationDeletionRequest,
        expected_epoch: Uuid,
    ) -> ConversationDeletionFuture<'_> {
        let _ = (request, expected_epoch);
        Box::pin(async { Err(CatalogError::Unavailable.into()) })
    }
    /// Inspect only the original SQL publication. A missing receipt does not
    /// prove that external workspace cleanup has never run or authorize a new ID.
    fn deletion_status(
        &self,
        request: ConversationDeletionRequest,
    ) -> CatalogMutationFuture<'_, CatalogMutationStatus> {
        let _ = request;
        Box::pin(async { Err(CatalogError::Unavailable.into()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Unsupported;
    impl ConversationDeletionStore for Unsupported {
        fn delete(&self, _: ConversationDeletionRequest) -> ConversationDeletionFuture<'_> {
            panic!("must not fall back to delete")
        }
    }
    #[tokio::test]
    async fn unsupported_epoch_never_calls_unfenced_deletion() {
        let request = ConversationDeletionRequest {
            request_id: Uuid::from_u128(1),
            conversation_id: ConversationId::from_uuid(Uuid::from_u128(2)),
            binding: None,
            expected_title: "Synthetic".into(),
            expected_durable_count: 0,
            force: false,
        };
        assert_eq!(
            Unsupported
                .delete_in_epoch(request, Uuid::from_u128(3))
                .await,
            Err(CatalogError::Unavailable.into())
        );
    }
}
