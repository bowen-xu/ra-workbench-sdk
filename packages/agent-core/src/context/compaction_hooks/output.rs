//! SessionStart output contract adapted from Codex hooks/src/events/session_start.rs
//! and hooks/src/engine/output_parser.rs, Apache-2.0 / Copyright 2025 OpenAI,
//! commit e363b08c9175ac1cbe5893615dd2cb9ddf95043b. Host storage/spilling is separate.
use super::{CompactionHookOutcome, CompactionHookStage};
use serde::Deserialize;
use std::{future::Future, pin::Pin};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactionHookResult {
    pub outcome: CompactionHookOutcome,
    /// Already decoded host context, not model-generated compaction output.
    /// Stop retains it for later turns; the caller must persist before aborting.
    pub additional_contexts: Vec<String>,
}

pub type CompactionHookResultFuture<'a> =
    Pin<Box<dyn Future<Output = CompactionHookResult> + Send + 'a>>;

#[derive(Debug, thiserror::Error)]
#[error("hook context preparation unavailable")]
pub struct HookContextError;
pub type HookContextPreparation<'a> =
    Pin<Box<dyn Future<Output = Result<CompactionHookResult, HookContextError>> + Send + 'a>>;

impl CompactionHookResult {
    pub fn without_context(outcome: CompactionHookOutcome) -> Self {
        Self {
            outcome,
            additional_contexts: vec![],
        }
    }

    /// The host supplies its captured-output byte bound. Never silently truncate
    /// JSON or use invalid JSON-looking stdout as a context fragment.
    pub fn from_process_output(
        stage: CompactionHookStage,
        exit_code: Option<i32>,
        stdout: &str,
        max_output_bytes: usize,
    ) -> Self {
        if stdout.len() > max_output_bytes || exit_code != Some(0) {
            return Self::without_context(CompactionHookOutcome::Failed);
        }
        if stage != CompactionHookStage::SessionStartCompact {
            return Self::without_context(CompactionHookOutcome::from_process_output(
                exit_code, stdout,
            ));
        }
        let trimmed = stdout.trim();
        if trimmed.is_empty() {
            return Self::without_context(CompactionHookOutcome::Continue);
        }
        if !trimmed.starts_with(['{', '[']) {
            return Self {
                outcome: CompactionHookOutcome::Continue,
                additional_contexts: vec![trimmed.to_owned()],
            };
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(stdout) else {
            return Self::without_context(CompactionHookOutcome::Failed);
        };
        if !value.is_object() {
            return Self::without_context(CompactionHookOutcome::Failed);
        }
        let Ok(output) = serde_json::from_value::<SessionStartOutput>(value) else {
            return Self::without_context(CompactionHookOutcome::Failed);
        };
        let outcome = if !output.continue_execution {
            CompactionHookOutcome::Stop
        } else {
            CompactionHookOutcome::Continue
        };
        Self {
            outcome,
            additional_contexts: output
                .hook_specific_output
                .and_then(|specific| specific.additional_context)
                .into_iter()
                .collect(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionStartOutput {
    #[serde(rename = "continue", default = "continue_by_default")]
    continue_execution: bool,
    // Validate universal output fields without promoting diagnostics to context.
    #[serde(rename = "stopReason")]
    _stop_reason: Option<String>,
    #[serde(rename = "suppressOutput", default)]
    _suppress_output: bool,
    #[serde(rename = "systemMessage")]
    _system_message: Option<String>,
    hook_specific_output: Option<SessionStartSpecificOutput>,
}

fn continue_by_default() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionStartSpecificOutput {
    #[serde(rename = "hookEventName")]
    _event: SessionStartEvent,
    additional_context: Option<String>,
}

#[derive(Deserialize)]
enum SessionStartEvent {
    SessionStart,
}

#[cfg(test)]
mod tests;
