//! Shared immutable context and submission diagnostics.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContextSourceKind {
    Manuscript,
    Paper,
    Note,
    Retrieval,
    UserResource,
}

/// Version and anchor are opaque identifiers owned by the source adapter, not
/// filesystem access grants or instructions. Text is the frozen materialization.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextText {
    pub source_id: String,
    pub kind: ContextSourceKind,
    pub resource_id: String,
    pub revision: String,
    pub anchor: Option<String>,
    pub text: String,
}

impl ContextText {
    /// Build a frozen retrieval fragment with the stable source identity used
    /// by every Agent host. The host must validate the trace's scope, query,
    /// expiry and authorization before calling this constructor; this method
    /// only encodes the provider-neutral submission shape.
    pub fn retrieval(
        trace_id: &str,
        resource_id: &str,
        revision: &str,
        query: &str,
        text: String,
        anchor: Option<String>,
    ) -> Result<Self, SubmissionError> {
        if trace_id.trim().is_empty()
            || trace_id.len() > 160
            || trace_id.chars().any(char::is_control)
            || resource_id.trim().is_empty()
            || revision.trim().is_empty()
            || query.trim().is_empty()
            || query.len() > 16_384
            || query.chars().any(char::is_control)
        {
            return Err(SubmissionError::InvalidInput);
        }
        Ok(Self {
            source_id: format!("retrieval:{trace_id}"),
            kind: ContextSourceKind::Retrieval,
            resource_id: resource_id.to_owned(),
            revision: revision.to_owned(),
            anchor,
            text,
        })
    }
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum SubmissionError {
    #[error("invalid submission input")]
    InvalidInput,
    #[error("submission identity reused with different input")]
    Conflict,
    #[error("conversation or submission not found")]
    NotFound,
    #[error("submission storage unavailable")]
    Unavailable,
    #[error("submission is corrupt or unsupported")]
    Corrupt,
}
