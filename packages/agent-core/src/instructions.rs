// Adapted from OpenAI Codex core/src/agents_md.rs at
// e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Copyright 2025 OpenAI. See third-party/codex/LICENSE and NOTICE.
// Changes: application-owned provenance, validated fallback names, UTF-8-safe
// budget boundaries and explicit omissions; filesystem authority stays in host.

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum InstructionError {
    #[error("invalid instruction filename")]
    InvalidFilename,
    #[error("instruction source lacks provenance")]
    InvalidSource,
}
/// Candidate order is significant: the first existing file wins, even if empty.
/// These are filenames, never paths or an authorization to read another directory.
pub fn candidate_filenames(fallbacks: &[String]) -> Result<Vec<&str>, InstructionError> {
    let mut names = vec!["AGENTS.override.md", "AGENTS.md"];
    for candidate in fallbacks {
        let candidate = candidate.as_str();
        if candidate.is_empty() {
            continue;
        }
        if candidate == "."
            || candidate == ".."
            || candidate.contains(['/', '\\', ':'])
            || candidate.chars().any(char::is_control)
        {
            return Err(InstructionError::InvalidFilename);
        }
        if !names.contains(&candidate) {
            names.push(candidate);
        }
    }
    Ok(names)
}
/// Host has already authorized, read and versioned each source. Scope is an
/// opaque resource identity; a PDF/RAG hit must never be supplied as instructions.
/// Supply project entries in root-to-cwd order within each approved environment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstructionDocument {
    pub environment_id: String,
    pub scope_id: String,
    pub source_id: String,
    pub revision: String,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstructionDisposition {
    Included,
    Truncated,
    Empty,
    BudgetExcluded,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionFragment {
    pub environment_id: String,
    pub scope_id: String,
    pub source_id: String,
    pub revision: String,
    pub original_bytes: usize,
    pub text: String,
    pub disposition: InstructionDisposition,
}
/// A shared byte budget spans all environments. Provenance records survive even
/// when content is omitted. The host must bound reads before calling this method;
/// this is an assembly budget, not a filesystem/memory security boundary.
pub fn assemble_instructions(
    documents: Vec<InstructionDocument>,
    max_bytes: usize,
) -> Result<Vec<InstructionFragment>, InstructionError> {
    let mut remaining = max_bytes;
    let mut fragments = Vec::with_capacity(documents.len());
    for doc in documents {
        if [
            &doc.environment_id,
            &doc.scope_id,
            &doc.source_id,
            &doc.revision,
        ]
        .iter()
        .any(|value| value.trim().is_empty())
        {
            return Err(InstructionError::InvalidSource);
        }
        let original_bytes = doc.text.len();
        let (text, disposition) = if doc.text.trim().is_empty() {
            (String::new(), InstructionDisposition::Empty)
        } else if remaining == 0 {
            (String::new(), InstructionDisposition::BudgetExcluded)
        } else {
            let mut end = original_bytes.min(remaining);
            while !doc.text.is_char_boundary(end) {
                end -= 1;
            }
            let disposition = if end == original_bytes {
                InstructionDisposition::Included
            } else {
                InstructionDisposition::Truncated
            };
            // Reserve an unusable trailing partial codepoint too: later scopes
            // must not jump ahead of an earlier source that exhausted the budget.
            remaining = remaining.saturating_sub(original_bytes);
            (doc.text[..end].to_owned(), disposition)
        };
        fragments.push(InstructionFragment {
            environment_id: doc.environment_id,
            scope_id: doc.scope_id,
            source_id: doc.source_id,
            revision: doc.revision,
            original_bytes,
            text,
            disposition,
        });
    }
    Ok(fragments)
}
