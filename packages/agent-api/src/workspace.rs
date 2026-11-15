//! Non-Git workspace baselines. File comparison adapted from OpenAI Codex
//! git-utils/src/baseline.rs::diff_entries at e363b08c9175ac1cbe5893615dd2cb9ddf95043b.
//! Copyright 2025 OpenAI, Apache-2.0; see third-party/codex/{LICENSE,NOTICE}.
//! Changes: SHA-256/size/mode instead of Git OIDs; research source/editor revisions,
//! validated portable paths and bounded manifests; no filesystem or Git reset.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum WorkspaceError {
    #[error("invalid workspace manifest")]
    Invalid,
    #[error("workspace exceeds its budget")]
    Budget,
    #[error("workspace source has changed")]
    Conflict,
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
