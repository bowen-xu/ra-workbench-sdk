//! Immutable catalog intents and safe storage failures, without a database driver.
use super::{CatalogError, ConversationBinding, ConversationId};
use serde::{Serialize, ser::SerializeStruct};
use std::{future::Future, pin::Pin};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveConversation {
    pub operation_id: Uuid,
    pub id: ConversationId,
    pub archived: bool,
    /// Archive validates this exact complete history; restore does not read it.
    pub expected_watermark: Option<u64>,
}
impl ArchiveConversation {
    pub fn validate(&self) -> Result<(), CatalogError> {
        if self.operation_id.is_nil()
            || self.id.as_uuid().is_nil()
            || self.archived != self.expected_watermark.is_some()
            || self
                .expected_watermark
                .is_some_and(|watermark| watermark > 9_007_199_254_740_991)
        {
            return Err(CatalogError::InvalidInput);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateBoundConversation {
    pub operation_id: Uuid,
    pub id: ConversationId,
    /// The original resource identity is preserved for receipt matching.
    pub binding: ConversationBinding,
}
impl CreateBoundConversation {
    pub fn validate(&self) -> Result<(), CatalogError> {
        let resource = &self.binding.resource_id;
        if self.operation_id.is_nil()
            || self.id.as_uuid().is_nil()
            || resource.trim().is_empty()
            || resource.chars().count() > 256
            || resource.contains('\0')
        {
            return Err(CatalogError::InvalidInput);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RenameConversation {
    pub operation_id: Uuid,
    pub id: ConversationId,
    /// Kept verbatim for identity and title CAS, never replaced with a fresh read.
    pub expected_title: String,
    /// Identity includes the original text; only the business write trims it.
    pub title: String,
}
impl RenameConversation {
    pub fn validate(&self) -> Result<(), CatalogError> {
        let title = self.title.trim();
        if self.operation_id.is_nil()
            || self.id.as_uuid().is_nil()
            || title.is_empty()
            || title.chars().count() > 180
            || title.contains('\0')
        {
            return Err(CatalogError::InvalidInput);
        }
        Ok(())
    }
}

/// Historical proof of one metadata mutation, never current conversation metadata.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogMutationProof {
    pub operation_id: Uuid,
    pub conversation_id: ConversationId,
    pub epoch: Uuid,
    pub sql_fence: u64,
    pub replayed: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CatalogMutationStatus {
    Committed(CatalogMutationProof),
    NoSqlReceipt {
        epoch: Uuid,
        sql_fence: u64,
        closed: bool,
    },
    Unconfirmed {
        epoch: Uuid,
        sql_fence: u64,
        blocked: bool,
        closed: bool,
        reason: &'static str,
    },
}
pub type RenameProof = CatalogMutationProof;
pub type CreateBoundProof = CatalogMutationProof;
pub type RenameStatus = CatalogMutationStatus;
pub type CreateBoundStatus = CatalogMutationStatus;
pub type ArchiveProof = CatalogMutationProof;
pub type ArchiveStatus = CatalogMutationStatus;

/// Only classifications and numeric storage codes cross this port. SQL text,
/// bindings, private titles and database driver messages are excluded.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMutationDiagnostic {
    pub operation_id: Uuid,
    pub epoch: Option<Uuid>,
    pub sql_fence: Option<String>,
    pub phase: &'static str,
    pub sqlite_code: Option<String>,
    pub sqlite_extended_code: Option<i32>,
    pub safe_cause: &'static str,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogDataFailureKind {
    Invalid,
    Unmanaged,
    Conflict,
    Unknown,
    Partial,
    ExternalUnknown,
    RecoveryRequired,
    Unavailable,
    Corrupt,
}
impl CatalogDataFailureKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::Invalid => "DATA_SQL_INVALID",
            Self::Unmanaged => "DATA_SQL_UNMANAGED",
            Self::Conflict => "DATA_SQL_OPERATION_CONFLICT",
            Self::Unknown => "DATA_SQL_COMMIT_UNKNOWN",
            Self::Partial => "DATA_OPERATION_PARTIAL",
            Self::ExternalUnknown => "DATA_OPERATION_OUTCOME_UNKNOWN",
            Self::RecoveryRequired => "DATA_SQL_RECOVERY_REQUIRED",
            Self::Unavailable => "DATA_SQL_UNAVAILABLE",
            Self::Corrupt => "DATA_SQL_CORRUPT",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogDataFailure {
    pub kind: CatalogDataFailureKind,
    pub diagnostic: Box<CatalogMutationDiagnostic>,
}
impl std::fmt::Display for CatalogDataFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {:?}", self.kind.code(), self.diagnostic)
    }
}
impl std::error::Error for CatalogDataFailure {}
impl Serialize for CatalogDataFailure {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("CatalogDataFailure", 2)?;
        state.serialize_field("code", self.kind.code())?;
        state.serialize_field("reason", &self.diagnostic)?;
        state.end()
    }
}
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CatalogMutationError {
    #[error(transparent)]
    Domain(#[from] CatalogError),
    #[error(transparent)]
    Data(#[from] CatalogDataFailure),
}
pub type CatalogMutationFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, CatalogMutationError>> + Send + 'a>>;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creation_preserves_raw_binding_and_has_a_distinct_operation_identity() {
        let command = CreateBoundConversation {
            operation_id: Uuid::from_u128(1),
            id: ConversationId::from_uuid(Uuid::from_u128(2)),
            binding: ConversationBinding {
                kind: super::super::BindingKind::Note,
                resource_id: " note ".into(),
            },
        };
        command.validate().unwrap();
        assert_eq!(command.binding.resource_id, " note ");
        for resource in [" ".into(), "x".repeat(257), "bad\0id".into()] {
            let mut invalid = command.clone();
            invalid.binding.resource_id = resource;
            assert_eq!(invalid.validate(), Err(CatalogError::InvalidInput));
        }
        assert_eq!(
            CreateBoundConversation {
                operation_id: Uuid::nil(),
                ..command
            }
            .validate(),
            Err(CatalogError::InvalidInput)
        );
    }
    #[test]
    fn rename_keeps_raw_intent_and_treats_expected_title_as_an_opaque_cas() {
        let command = RenameConversation {
            operation_id: Uuid::from_u128(1),
            id: ConversationId::from_uuid(Uuid::from_u128(2)),
            expected_title: format!("{}\0", "旧".repeat(200)),
            title: " New title ".into(),
        };
        command.validate().unwrap();
        assert_eq!(command.title, " New title ");
        assert_ne!(
            command,
            RenameConversation {
                title: "New title".into(),
                ..command.clone()
            }
        );
        for title in [" ".into(), "x".repeat(181), "bad\0title".into()] {
            assert_eq!(
                RenameConversation {
                    title,
                    ..command.clone()
                }
                .validate(),
                Err(CatalogError::InvalidInput)
            );
        }
    }
}
