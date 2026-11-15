//! Git contracts and parsers adapted from Codex `git-utils` at
//! `e363b08c9175ac1cbe5893615dd2cb9ddf95043b` (Apache-2.0).
//!
//! The core owns no filesystem or process access. Native adapters provide the
//! command runner and use these validated values for repository/worktree state.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GitError {
    #[error("not a git repository")]
    NotRepository,
    #[error("invalid git value")]
    Invalid,
    #[error("git output is malformed")]
    Malformed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GitSha(String);

impl GitSha {
    pub fn new(value: &str) -> Result<Self, GitError> {
        let value = value.trim();
        if !(value.len() == 40 || value.len() == 64)
            || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(GitError::Invalid);
        }
        Ok(Self(value.to_ascii_lowercase()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitRepository {
    pub root: String,
    pub git_dir: String,
    pub worktree: Option<String>,
    pub head: Option<GitSha>,
    pub branch: Option<String>,
    pub remotes: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitWorktree {
    pub path: String,
    pub head: Option<GitSha>,
    pub branch: Option<String>,
    pub bare: bool,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitSummary {
    pub sha: GitSha,
    pub timestamp_unix_seconds: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub original_path: Option<String>,
    pub kind: GitChangeKind,
    pub staged: bool,
    pub unstaged: bool,
}

/// Parse `git status --porcelain=v2 -z --branch` without relying on locale.
/// This preserves the upstream distinction between staged and working-tree
/// changes and never treats a user path as a command argument.
pub fn parse_status_porcelain_v2(
    output: &[u8],
) -> Result<(Option<String>, Vec<GitStatusEntry>), GitError> {
    let records = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    let mut branch = None;
    let mut entries = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        index += 1;
        if record.starts_with(b"# branch.head ") {
            branch =
                Some(String::from_utf8(record[14..].to_vec()).map_err(|_| GitError::Malformed)?);
            continue;
        }
        if record[0] == b'#' {
            // branch.oid, branch.upstream and ahead/behind headers are
            // informational; only branch.head belongs in the shared summary.
            continue;
        }
        if record[0] == b'?' {
            let path = String::from_utf8(record.get(2..).unwrap_or_default().to_vec())
                .map_err(|_| GitError::Malformed)?;
            validate_relative_path(&path)?;
            entries.push(GitStatusEntry {
                path,
                original_path: None,
                kind: GitChangeKind::Untracked,
                staged: false,
                unstaged: true,
            });
            continue;
        }
        if record[0] != b'1' && record[0] != b'2' && record[0] != b'u' {
            return Err(GitError::Malformed);
        }
        let text = String::from_utf8(record.to_vec()).map_err(|_| GitError::Malformed)?;
        let fields = text
            .splitn(if record[0] == b'2' { 10 } else { 9 }, ' ')
            .collect::<Vec<_>>();
        let tag = fields.first().copied().ok_or(GitError::Malformed)?;
        let xy = fields.get(1).copied().ok_or(GitError::Malformed)?;
        if xy.len() != 2 {
            return Err(GitError::Malformed);
        }
        let path = fields
            .last()
            .copied()
            .ok_or(GitError::Malformed)?
            .to_string();
        validate_relative_path(&path)?;
        let (kind, original_path) = if tag == "u" {
            (GitChangeKind::Conflicted, None)
        } else if tag == "2" {
            // Rename/copy records carry the destination in this record and
            // the original path in the next NUL record.
            let original = records.get(index).ok_or(GitError::Malformed)?;
            index += 1;
            let original = String::from_utf8(original.to_vec()).map_err(|_| GitError::Malformed)?;
            validate_relative_path(&original)?;
            (GitChangeKind::Renamed, Some(original))
        } else {
            (kind_from_xy(xy)?, None)
        };
        entries.push(GitStatusEntry {
            path,
            original_path,
            kind,
            staged: xy.as_bytes()[0] != b'.',
            unstaged: xy.as_bytes()[1] != b'.',
        });
    }
    Ok((branch, entries))
}

fn kind_from_xy(xy: &str) -> Result<GitChangeKind, GitError> {
    let bytes = xy.as_bytes();
    if bytes.contains(&b'U') {
        return Ok(GitChangeKind::Conflicted);
    }
    if bytes.contains(&b'A') {
        return Ok(GitChangeKind::Added);
    }
    if bytes.contains(&b'D') {
        return Ok(GitChangeKind::Deleted);
    }
    if bytes.contains(&b'R') {
        return Ok(GitChangeKind::Renamed);
    }
    if bytes.contains(&b'M') || bytes.contains(&b'T') {
        return Ok(GitChangeKind::Modified);
    }
    Err(GitError::Malformed)
}

pub fn parse_remote_urls(output: &str) -> BTreeMap<String, String> {
    let mut remotes = BTreeMap::new();
    for line in output.lines() {
        let mut fields = line.split_whitespace();
        let Some(name) = fields.next() else { continue };
        let Some(url) = fields.next() else { continue };
        let Some(kind) = fields.next() else { continue };
        if kind == "(fetch)" {
            remotes
                .entry(name.to_owned())
                .or_insert_with(|| url.to_owned());
        }
    }
    remotes
}

/// Parse `git worktree list --porcelain`. Reasons after `locked`/`prunable`
/// are intentionally ignored; they are diagnostic text, not authority.
pub fn parse_worktree_porcelain(output: &str) -> Result<Vec<GitWorktree>, GitError> {
    let mut result = Vec::new();
    let mut current: Option<GitWorktree> = None;
    for line in output.lines() {
        if line.is_empty() {
            if let Some(worktree) = current.take() {
                result.push(worktree);
            }
            continue;
        }
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "worktree" => {
                if let Some(worktree) = current.take() {
                    result.push(worktree);
                }
                if value.is_empty() || value.chars().any(char::is_control) {
                    return Err(GitError::Malformed);
                }
                current = Some(GitWorktree {
                    path: value.to_owned(),
                    head: None,
                    branch: None,
                    bare: false,
                    locked: false,
                    prunable: false,
                });
            }
            "HEAD" => {
                let worktree = current.as_mut().ok_or(GitError::Malformed)?;
                worktree.head = Some(GitSha::new(value)?);
            }
            "branch" => {
                let worktree = current.as_mut().ok_or(GitError::Malformed)?;
                let branch = value
                    .strip_prefix("refs/heads/")
                    .ok_or(GitError::Malformed)?;
                if branch.is_empty() || branch.chars().any(char::is_control) {
                    return Err(GitError::Malformed);
                }
                worktree.branch = Some(branch.to_owned());
            }
            "bare" => current.as_mut().ok_or(GitError::Malformed)?.bare = true,
            "detached" => {}
            "locked" => current.as_mut().ok_or(GitError::Malformed)?.locked = true,
            "prunable" => current.as_mut().ok_or(GitError::Malformed)?.prunable = true,
            _ => return Err(GitError::Malformed),
        }
    }
    if let Some(worktree) = current {
        result.push(worktree);
    }
    if result.is_empty() {
        return Err(GitError::Malformed);
    }
    Ok(result)
}

pub fn parse_log_records(output: &[u8]) -> Result<Vec<GitCommitSummary>, GitError> {
    let mut commits = Vec::new();
    let fields = output
        .split(|byte| *byte == 0)
        .filter(|record| {
            !record.is_empty() && !record.iter().all(|byte| byte.is_ascii_whitespace())
        })
        .collect::<Vec<_>>();
    for record in fields.chunks(3) {
        if record.len() != 3 {
            return Err(GitError::Malformed);
        }
        let sha = GitSha::new(std::str::from_utf8(record[0]).map_err(|_| GitError::Malformed)?)?;
        let timestamp = std::str::from_utf8(record[1])
            .map_err(|_| GitError::Malformed)?
            .parse::<i64>()
            .map_err(|_| GitError::Malformed)?;
        let subject = String::from_utf8(record[2].to_vec()).map_err(|_| GitError::Malformed)?;
        if subject.is_empty() || subject.len() > 4096 || subject.chars().any(char::is_control) {
            return Err(GitError::Malformed);
        }
        commits.push(GitCommitSummary {
            sha,
            timestamp_unix_seconds: timestamp,
            subject,
        });
    }
    Ok(commits)
}

/// Codex's remote canonicalization is kept in the shared layer so history and
/// provenance compare equivalent HTTPS/SSH forms consistently.
pub fn canonicalize_remote_url(value: &str) -> Option<String> {
    let mut value = value.trim().trim_end_matches('/').to_owned();
    if value.ends_with(".git") {
        value.truncate(value.len() - 4);
    }
    if let Some((scheme, rest)) = value.split_once("://") {
        let (host, path) = rest.split_once('/')?;
        return canonical_host_path(
            host,
            path,
            matches!(scheme, "http" | "https" | "ssh" | "git"),
        );
    }
    let (host, path) = value.split_once(':')?;
    canonical_host_path(
        host.rsplit_once('@').map_or(host, |(_, host)| host),
        path,
        false,
    )
}

pub fn validate_branch_name(value: &str) -> Result<(), GitError> {
    if value.is_empty()
        || value.len() > 255
        || value.starts_with('-')
        || value.ends_with('.')
        || value.contains("..")
        || value.contains("@{")
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(GitError::Invalid);
    }
    Ok(())
}

fn canonical_host_path(host: &str, path: &str, supported_scheme: bool) -> Option<String> {
    if host.is_empty() || (!supported_scheme && path.is_empty()) {
        return None;
    }
    let parts = path
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.len() < 2 || parts.iter().any(|part| matches!(*part, "." | "..")) {
        return None;
    }
    let host = host
        .rsplit_once('@')
        .map_or(host, |(_, host)| host)
        .to_ascii_lowercase();
    let path = parts.join("/");
    Some(if host == "github.com" {
        format!("{host}/{}", path.to_ascii_lowercase())
    } else {
        format!("{host}/{path}")
    })
}

fn validate_relative_path(path: &str) -> Result<(), GitError> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\0')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(GitError::Invalid);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_staged_unstaged_entries() {
        let raw = b"# branch.head main\x001 .M N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 main.tex\x00? sections/new.tex\x00";
        let (branch, entries) = parse_status_porcelain_v2(raw).unwrap();
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(entries[0].kind, GitChangeKind::Modified);
        assert!(!entries[0].staged && entries[0].unstaged);
        assert_eq!(entries[1].kind, GitChangeKind::Untracked);
    }

    #[test]
    fn rejects_unsafe_paths_and_normalizes_remote() {
        let raw = b"? ../escape\0";
        assert_eq!(parse_status_porcelain_v2(raw), Err(GitError::Invalid));
        assert_eq!(
            canonicalize_remote_url("git@github.com:OpenAI/Codex.git").as_deref(),
            Some("github.com/openai/codex")
        );
        assert_eq!(
            canonicalize_remote_url("https://github.com/OpenAI/Codex/").as_deref(),
            Some("github.com/openai/codex")
        );
    }

    #[test]
    fn consumes_porcelain_rename_source_after_the_destination() {
        let raw = b"2 R. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 new name.tex\x00old name.tex\x00";
        let (_, entries) = parse_status_porcelain_v2(raw).unwrap();
        assert_eq!(entries[0].kind, GitChangeKind::Renamed);
        assert_eq!(entries[0].path, "new name.tex");
        assert_eq!(entries[0].original_path.as_deref(), Some("old name.tex"));
    }

    #[test]
    fn parses_worktree_records_and_ignores_diagnostic_reasons() {
        let text = "worktree /tmp/main\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n\nworktree /tmp/agent\nHEAD 2222222222222222222222222222222222222222\ndetached\nlocked by agent\nprunable stale\n";
        let worktrees = parse_worktree_porcelain(text).unwrap();
        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
        assert!(worktrees[1].locked && worktrees[1].prunable);
    }

    #[test]
    fn parses_bounded_commit_log_records() {
        let raw = b"1111111111111111111111111111111111111111\x001700000000\x00initial commit\x00";
        let commits = parse_log_records(raw).unwrap();
        assert_eq!(commits[0].subject, "initial commit");
        assert_eq!(commits[0].timestamp_unix_seconds, 1_700_000_000);
    }
}
