use super::*;
mod diagnostic;
pub use diagnostic::{InvalidToolOutcomeDiagnostic, ToolOutcomeDiagnostic};

#[derive(Clone, Debug, thiserror::Error)]
pub enum RunError {
    #[error(transparent)]
    Model(ModelError),
    #[error("tool request rejected")]
    ToolRejected,
    #[error("tool handler not found")]
    ToolNotFound,
    /// Bounded metadata from pre-execution validation; never tool arguments.
    #[error("tool request rejected: {0}")]
    ToolRejectionDiagnostic(String),
    /// Recoverable argument error, with bounded, user-safe guidance supplied by
    /// the tool owner. Never use this for authorization or protocol failures.
    #[error("invalid tool arguments: {0}")]
    ToolArguments(String),
    #[error("tool execution unavailable")]
    ToolUnavailable,
    #[error("host_finalization_failed: host finalization did not complete")]
    HostFinalizationFailed,
    /// The owner cannot confirm whether a started effect completed. Do not
    /// synthesize ordinary retry feedback or sample again until reconciled.
    #[error("tool_outcome_unknown: tool execution outcome requires recovery")]
    ToolOutcomeUnknown,
    /// Closed native-owner metadata; the same recovery barrier as the unit form.
    #[error("tool_outcome_unknown: {0}")]
    ToolOutcomeUnknownDiagnostic(Box<ToolOutcomeDiagnostic>),
    #[error("run event persistence failed")]
    EventSink,
    /// The result item was persisted but its owner could not confirm release.
    /// Keep the persistence barrier while retaining validated recovery metadata.
    #[error("run event persistence failed: {0}")]
    EventSinkDiagnostic(Box<ToolOutcomeDiagnostic>),
    #[error("run budget exhausted")]
    Budget,
}

impl From<ModelError> for RunError {
    fn from(error: ModelError) -> Self {
        match error {
            ModelError::Persistence => Self::EventSink,
            ModelError::PersistenceDiagnostic(detail) => {
                let value = serde_json::json!({
                    "code": "context_persistence_failure",
                    "phase": detail.phase,
                    "safeCause": detail.safe_cause,
                    "conversationId": detail.conversation_id,
                    "sqliteExtendedCode": detail.sqlite_extended_code,
                });
                ToolOutcomeDiagnostic::try_from_value(value)
                    .map(|value| Self::EventSinkDiagnostic(Box::new(value)))
                    .unwrap_or(Self::EventSink)
            }
            _ => Self::Model(error),
        }
    }
}

impl RunError {
    /// An unconfirmed durable result or owner receipt must stop subsequent writes.
    pub fn is_event_sink(&self) -> bool {
        matches!(
            self,
            Self::EventSink
                | Self::EventSinkDiagnostic(_)
                | Self::Model(ModelError::Persistence | ModelError::PersistenceDiagnostic(_))
        )
    }

    pub fn failure_category(&self) -> FailureCategory {
        match self {
            Self::ToolRejected
            | Self::ToolNotFound
            | Self::ToolRejectionDiagnostic(_)
            | Self::ToolUnavailable
            | Self::HostFinalizationFailed
            | Self::ToolArguments(_) => FailureCategory::ToolRound,
            Self::ToolOutcomeUnknown | Self::ToolOutcomeUnknownDiagnostic(_) => {
                FailureCategory::Recovery
            }
            Self::EventSink
            | Self::EventSinkDiagnostic(_)
            | Self::Model(ModelError::Persistence | ModelError::PersistenceDiagnostic(_)) => {
                FailureCategory::Persistence
            }
            Self::Model(
                ModelError::Unavailable
                | ModelError::TimedOut
                | ModelError::ConnectionFailed
                | ModelError::ResponseReadFailed
                | ModelError::RateLimited
                | ModelError::HttpRateLimited(_)
                | ModelError::ServerOverloaded
                | ModelError::UnexpectedStatus(500..=599)
                | ModelError::InternalServerError,
            ) => FailureCategory::ProviderTemporaryUnavailable,
            Self::Model(_) => FailureCategory::Provider,
            Self::Budget => FailureCategory::Admission,
        }
    }
}

impl From<ModelError> for FailureCategory {
    fn from(error: ModelError) -> Self {
        match error {
            ModelError::Persistence | ModelError::PersistenceDiagnostic(_) => Self::Persistence,
            ModelError::Unavailable
            | ModelError::TimedOut
            | ModelError::ConnectionFailed
            | ModelError::ResponseReadFailed
            | ModelError::RateLimited
            | ModelError::HttpRateLimited(_)
            | ModelError::ServerOverloaded
            | ModelError::UnexpectedStatus(500..=599)
            | ModelError::InternalServerError => Self::ProviderTemporaryUnavailable,
            _ => Self::Provider,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounting_persistence_failure_is_a_recovery_barrier() {
        let error = RunError::from(ModelError::Persistence);
        assert!(error.is_event_sink());
        assert!(matches!(
            error.failure_category(),
            FailureCategory::Persistence
        ));
        assert!(matches!(
            RunError::from(ModelError::Unavailable),
            RunError::Model(ModelError::Unavailable)
        ));
    }

    #[test]
    fn accounting_diagnostic_retains_safe_storage_evidence_at_the_barrier() {
        let id = uuid::Uuid::from_u128(1);
        let error = RunError::from(ModelError::PersistenceDiagnostic(
            ContextPersistenceDiagnostic {
                conversation_id: id,
                phase: "commit",
                safe_cause: "sql_commit_outcome_unknown",
                sqlite_extended_code: Some(787),
            },
        ));
        assert!(error.is_event_sink());
        let RunError::EventSinkDiagnostic(detail) = error else {
            panic!("diagnostic lost")
        };
        let value = serde_json::to_value(detail).unwrap();
        assert_eq!(value["conversationId"], id.to_string());
        assert_eq!(value["phase"], "commit");
        assert_eq!(value["sqliteExtendedCode"], 787);
        assert_eq!(value["safeCause"], "sql_commit_outcome_unknown");
    }
}
