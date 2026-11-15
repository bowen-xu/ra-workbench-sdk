//! Non-Git workspace baselines. File comparison adapted from OpenAI Codex
//! git-utils/src/baseline.rs::diff_entries at e363b08c9175ac1cbe5893615dd2cb9ddf95043b.
//! Copyright 2025 OpenAI, Apache-2.0; see third-party/codex/{LICENSE,NOTICE}.
//! Changes: SHA-256/size/mode instead of Git OIDs; research source/editor revisions,
//! validated portable paths and bounded manifests; no filesystem or Git reset.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub const MAX_FILES: usize = 10_000;
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_WORKSPACE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum WorkspaceError {
    #[error("invalid workspace manifest")]
    Invalid,
    #[error("workspace exceeds its budget")]
    Budget,
    #[error("workspace source has changed")]
    Conflict,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceIdentity {
    pub lease_id: Uuid,
    pub conversation_id: Uuid,
    pub turn_id: Uuid,
    pub environment_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileVersion {
    pub sha256: String,
    pub byte_size: u64,
    pub executable: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorVersion {
    pub session_id: Uuid,
    pub revision: Uuid,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceVersion {
    pub resource_id: String,
    /// Host revision of the original source, independent of a working buffer hash.
    pub revision: String,
    pub editor: Option<EditorVersion>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceFile {
    pub path: String,
    pub version: FileVersion,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaselineFile {
    pub file: WorkspaceFile,
    pub source: SourceVersion,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceManifest {
    pub schema_version: u32,
    pub identity: WorkspaceIdentity,
    /// Baseline contains the initial working bytes (including captured buffers).
    /// Those user bytes are not agent changes. No raw source bytes are in metadata.
    pub files: Vec<BaselineFile>,
}
fn valid_identity(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control)
}
impl SourceVersion {
    fn validate(&self) -> Result<(), WorkspaceError> {
        if !valid_identity(&self.resource_id)
            || !valid_identity(&self.revision)
            || self
                .editor
                .as_ref()
                .is_some_and(|editor| editor.session_id.is_nil() || editor.revision.is_nil())
        {
            return Err(WorkspaceError::Invalid);
        }
        Ok(())
    }
}
impl WorkspaceManifest {
    pub fn validate(&self) -> Result<(), WorkspaceError> {
        if self.schema_version != 1
            || self.identity.lease_id.is_nil()
            || self.identity.conversation_id.is_nil()
            || self.identity.turn_id.is_nil()
            || !valid_identity(&self.identity.environment_id)
        {
            return Err(WorkspaceError::Invalid);
        }
        validate_files(self.files.iter().map(|entry| &entry.file))?;
        for entry in &self.files {
            entry.source.validate()?;
        }
        Ok(())
    }
}

/// Reserved native recovery namespace, also excluded from manuscript exports
/// and compiler inputs. Ordinary user backup names are not reserved.
pub fn is_recovery_file_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with(".agent-before-") || name.starts_with(".agent-create-")
}

#[cfg(test)]
mod recovery_path_tests {
    use super::*;

    #[test]
    fn excludes_recovery_names_at_every_level_without_excluding_user_backups() {
        for path in [
            ".agent-before-original.bak",
            "sections/.AGENT-CREATE-stage.tmp",
            ".agent-before-dir/main.tex",
            ".git/config",
            ".agents/instructions.md",
            ".codex/config.toml",
        ] {
            assert!(validate_path(path).is_err(), "{path}");
        }
        for path in ["main.tex", "sections/draft.bak", ".agent-notes.tex"] {
            assert!(validate_path(path).is_ok(), "{path}");
        }
    }
}

/// Portable path grammar, independent of the platform's path normalizer. The
/// native adapter must additionally enforce opened-directory ownership, reject
/// links/special files and detect filesystem-specific aliases during creation.
pub fn validate_path(path: &str) -> Result<(), WorkspaceError> {
    if path.is_empty()
        || path.len() > 1024
        || path.chars().any(|ch| {
            ch.is_control() || matches!(ch, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        || path.split('/').count() > 64
    {
        return Err(WorkspaceError::Invalid);
    }
    for part in path.split('/') {
        let lower = part.to_ascii_lowercase();
        let stem = lower.split('.').next().unwrap_or(&lower);
        let device = matches!(stem, "con" | "prn" | "aux" | "nul")
            || stem
                .strip_prefix("com")
                .or_else(|| stem.strip_prefix("lpt"))
                .is_some_and(|suffix| {
                    matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
                });
        if matches!(part, "" | "." | "..")
            || part.ends_with([' ', '.'])
            || matches!(lower.as_str(), ".git" | ".agents" | ".codex")
            || is_recovery_file_name(part)
            || device
        {
            return Err(WorkspaceError::Invalid);
        }
    }
    Ok(())
}

pub fn validate_files<'a>(
    files: impl IntoIterator<Item = &'a WorkspaceFile>,
) -> Result<(), WorkspaceError> {
    let mut paths = BTreeSet::new();
    let mut total = 0u64;
    for file in files {
        validate_path(&file.path)?;
        if file.version.sha256.len() != 64
            || !file
                .version
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || !paths.insert(file.path.as_str())
        {
            return Err(WorkspaceError::Invalid);
        }
        total = total
            .checked_add(file.version.byte_size)
            .ok_or(WorkspaceError::Budget)?;
        if paths.len() > MAX_FILES
            || file.version.byte_size > MAX_FILE_BYTES
            || total > MAX_WORKSPACE_BYTES
        {
            return Err(WorkspaceError::Budget);
        }
    }
    // A file cannot also be an ancestor directory; check every ancestor, rather
    // than only adjacent lexical entries ("a-foo" may sort between "a" and "a/b").
    for path in &paths {
        for (offset, _) in path.match_indices('/') {
            if paths.contains(&path[..offset]) {
                return Err(WorkspaceError::Invalid);
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeKind {
    Added,
    Modified,
    Deleted,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub kind: FileChangeKind,
    pub path: String,
    pub before: Option<FileVersion>,
    pub after: Option<FileVersion>,
    pub source: Option<SourceVersion>,
}
/// Compare the working snapshot with its immutable baseline. This is a proposal
/// inventory, not authorization to apply it; acceptance must revalidate sources.
pub fn compare(
    manifest: &WorkspaceManifest,
    current: &[WorkspaceFile],
) -> Result<Vec<FileChange>, WorkspaceError> {
    manifest.validate()?;
    validate_files(current)?;
    let head: BTreeMap<_, _> = manifest
        .files
        .iter()
        .map(|entry| (entry.file.path.as_str(), entry))
        .collect();
    let current: BTreeMap<_, _> = current
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    let mut changes = vec![];
    for (path, file) in &current {
        match head.get(path) {
            None => changes.push(FileChange {
                kind: FileChangeKind::Added,
                path: (*path).into(),
                before: None,
                after: Some(file.version.clone()),
                source: None,
            }),
            Some(base) if base.file.version != file.version => changes.push(FileChange {
                kind: FileChangeKind::Modified,
                path: (*path).into(),
                before: Some(base.file.version.clone()),
                after: Some(file.version.clone()),
                source: Some(base.source.clone()),
            }),
            Some(_) => {}
        }
    }
    for (path, base) in head {
        if !current.contains_key(path) {
            changes.push(FileChange {
                kind: FileChangeKind::Deleted,
                path: path.into(),
                before: Some(base.file.version.clone()),
                after: None,
                source: Some(base.source.clone()),
            });
        }
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

/// Pure conflict check used by the accepting host, which supplies authoritative
/// current source/editor versions. Missing sources never mean "use disk instead".
pub fn check_source(
    change: &FileChange,
    current: Option<&SourceVersion>,
) -> Result<(), WorkspaceError> {
    match (change.kind, change.source.as_ref(), current) {
        (FileChangeKind::Added, None, None) => Ok(()),
        (FileChangeKind::Modified | FileChangeKind::Deleted, Some(expected), Some(actual))
            if expected == actual =>
        {
            Ok(())
        }
        _ => Err(WorkspaceError::Conflict),
    }
}
