//! Text storage ports; mapping, approvals and durability belong to the host adapter.
use super::{Hunk, TextEdit, replace_with_edits};
use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin};

pub type BackendFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextSnapshot {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    pub text: String,
    pub version: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextChange {
    pub path: String,
    pub destination: Option<String>,
    pub before: Option<TextSnapshot>,
    pub after: Option<String>,
    #[serde(default)]
    pub edits: Vec<TextEdit>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetResult {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    pub status: TargetStatus,
    pub message: String,
    #[serde(default, alias = "proposalId")]
    pub change_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<i64>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetStatus {
    Applied,
    Proposed,
    Failed,
    Unknown,
}

pub trait TextBackend: Send + Sync {
    fn read<'a>(
        &'a self,
        path: &'a str,
        saved: bool,
        remember: bool,
    ) -> BackendFuture<'a, TextSnapshot>;
    fn preflight<'a>(&'a self, changes: &'a [TextChange]) -> BackendFuture<'a, ()>;
    fn commit<'a>(
        &'a self,
        request_id: &'a str,
        changes: Vec<TextChange>,
    ) -> BackendFuture<'a, Vec<TargetResult>>;
    fn query<'a>(&'a self, request_id: &'a str) -> BackendFuture<'a, Option<Vec<TargetResult>>>;
}

pub fn prepare(hunk: &Hunk, snapshot: Option<TextSnapshot>) -> Result<TextChange, String> {
    let (path, destination, after, edits) = match hunk {
        Hunk::AddFile { path, contents } => {
            if snapshot.is_some() {
                return Err("target already exists".into());
            }
            (path, None, Some(contents.clone()), vec![])
        }
        Hunk::DeleteFile { path } => {
            if snapshot.is_none() {
                return Err("target does not exist".into());
            }
            (path, None, None, vec![])
        }
        Hunk::UpdateFile {
            path,
            move_path,
            chunks,
        } => {
            let original = snapshot.as_ref().ok_or("target does not exist")?;
            let (text, edits) =
                replace_with_edits(&original.text, chunks).map_err(|error| error.to_string())?;
            (path, move_path.as_ref(), Some(text), edits)
        }
    };
    Ok(TextChange {
        path: path.to_str().ok_or("invalid path")?.into(),
        destination: destination.map(|path| path.to_string_lossy().into_owned()),
        before: snapshot,
        after,
        edits,
    })
}

#[cfg(test)]
mod receipt_tests {
    use super::*;

    #[test]
    fn legacy_proposal_identity_is_read_but_only_change_id_is_written() {
        let legacy = serde_json::json!({"path":"source://note", "status":"applied",
            "message":"saved", "proposalId":"change", "generation":2});
        let receipt: TargetResult = serde_json::from_value(legacy).unwrap();
        assert_eq!(receipt.change_id.as_deref(), Some("change"));
        let current = serde_json::to_value(&receipt).unwrap();
        assert_eq!(current["changeId"], "change");
        assert!(current.get("proposalId").is_none());
        let decoded: TargetResult = serde_json::from_value(current).unwrap();
        assert_eq!(decoded.change_id, receipt.change_id);
    }
}
