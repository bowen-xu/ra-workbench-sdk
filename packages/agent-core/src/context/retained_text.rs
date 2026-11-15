//! Adapted from OpenAI Codex compact_remote_v2.rs and utils/string/truncate.rs,
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b, Apache-2.0. Copyright 2025 OpenAI.
use super::compaction_strategy::CompactionFailure;
use crate::model::{ContentPart, ModelMessage};

/// Supplier-owned text accounting. Attachment storage remains a separate guard.
pub trait RetainedTextPolicy: Send + Sync {
    fn max_tokens(&self) -> u64;
    fn tokens(&self, text: &str) -> u64;
    fn truncate(&self, text: &str, tokens: u64) -> String;
}

/// Reviewed Responses approximation, not a tokenizer for arbitrary suppliers.
pub struct Utf8RetainedTextPolicy {
    pub max_tokens: u64,
}
impl RetainedTextPolicy for Utf8RetainedTextPolicy {
    fn max_tokens(&self) -> u64 {
        self.max_tokens
    }
    fn tokens(&self, text: &str) -> u64 {
        (text.len() as u64).div_ceil(4)
    }
    fn truncate(&self, text: &str, tokens: u64) -> String {
        let bytes = usize::try_from(tokens.saturating_mul(4)).unwrap_or(usize::MAX);
        if text.len() <= bytes {
            return text.to_owned();
        }
        let left = text.floor_char_boundary(bytes / 2);
        let right = text.ceil_char_boundary(text.len().saturating_sub(bytes - bytes / 2));
        let removed = ((text.len() - bytes) as u64).div_ceil(4);
        // As upstream, the marker is additional to the retained text allowance.
        format!(
            "{}…{removed} tokens truncated…{}",
            &text[..left],
            &text[right..]
        )
    }
}

/// Preserve newest messages, original part order, and attachments in the
/// boundary message. An attachment-only message consumes at least one token.
pub fn retain_users(
    users: Vec<ModelMessage>,
    policy: &dyn RetainedTextPolicy,
) -> Result<Vec<ModelMessage>, CompactionFailure> {
    let mut remaining = policy.max_tokens();
    if remaining == 0 {
        return Err(CompactionFailure::InvalidBudget);
    }
    let mut kept = Vec::new();
    for user in users.into_iter().rev() {
        let ModelMessage::User {
            content: parts,
            source_item_id,
        } = user
        else {
            return Err(CompactionFailure::InvalidOutput);
        };
        if remaining == 0 {
            continue;
        }
        let cost = parts
            .iter()
            .try_fold(0u64, |sum, part| {
                sum.checked_add(match part {
                    ContentPart::Text(text) => policy.tokens(text),
                    _ => 0,
                })
            })
            .ok_or(CompactionFailure::InvalidBudget)?
            .max(1);
        if cost <= remaining {
            remaining -= cost;
            kept.push(ModelMessage::User {
                content: parts,
                source_item_id,
            });
            continue;
        }
        let mut selected = Vec::new();
        for part in parts {
            match part {
                ContentPart::Text(text) => {
                    if remaining == 0 {
                        continue;
                    }
                    let cost = policy.tokens(&text);
                    let text = if cost <= remaining {
                        remaining -= cost;
                        text
                    } else {
                        let text = policy.truncate(&text, remaining);
                        remaining = 0;
                        text
                    };
                    if !text.is_empty() {
                        selected.push(ContentPart::Text(text));
                    }
                }
                image => selected.push(image),
            }
        }
        if !selected.is_empty() {
            kept.push(ModelMessage::User {
                content: selected,
                source_item_id,
            });
        }
        remaining = 0;
    }
    kept.reverse();
    Ok(kept)
}

#[cfg(test)]
#[path = "retained_text_tests.rs"]
mod tests;

/// Apply the supplier's text policy together with the host's independent byte
/// guard. Never discard the newest message to satisfy that guard: if its
/// attachments or minimum text representation cannot fit, reject the candidate.
pub fn retain_users_with_byte_budget(
    users: Vec<ModelMessage>,
    policy: &dyn RetainedTextPolicy,
    max_bytes: usize,
    measure: impl Fn(&[ModelMessage]) -> Option<usize>,
) -> Result<Vec<ModelMessage>, CompactionFailure> {
    if max_bytes == 0 {
        return Err(CompactionFailure::InvalidBudget);
    }
    let fits = |messages: &[ModelMessage]| {
        measure(messages)
            .map(|bytes| bytes <= max_bytes)
            .ok_or(CompactionFailure::InvalidBudget)
    };
    let full = retain_users(users.clone(), policy)?;
    if !users.is_empty() && full.is_empty() {
        return Err(CompactionFailure::InvalidOutput);
    }
    if fits(&full)? {
        return Ok(full);
    }
    // Rebuild each candidate from original text, never from a previous marker.
    // Every returned candidate is measured; custom supplier policies need not
    // produce an exactly maximal packing for this safety guard.
    let mut limited = LimitedPolicy {
        inner: policy,
        max: 1,
    };
    let mut best = retain_users(users.clone(), &limited)?;
    if best.is_empty() || !fits(&best)? {
        return Err(CompactionFailure::InvalidBudget);
    }
    let mut low = 2;
    let mut high = policy.max_tokens().saturating_sub(1);
    while low <= high {
        let middle = low + (high - low) / 2;
        limited.max = middle;
        let candidate = retain_users(users.clone(), &limited)?;
        if !candidate.is_empty() && fits(&candidate)? {
            best = candidate;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    Ok(best)
}

struct LimitedPolicy<'a> {
    inner: &'a dyn RetainedTextPolicy,
    max: u64,
}

impl RetainedTextPolicy for LimitedPolicy<'_> {
    fn max_tokens(&self) -> u64 {
        self.max
    }
    fn tokens(&self, text: &str) -> u64 {
        self.inner.tokens(text)
    }
    fn truncate(&self, text: &str, tokens: u64) -> String {
        self.inner.truncate(text, tokens)
    }
}
