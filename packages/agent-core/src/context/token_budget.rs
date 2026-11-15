//! Experimental TokenBudget policy migrated from OpenAI Codex (Apache-2.0),
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b, config/mod.rs,
//! session/context_window.rs and session/token_budget.rs. Copyright 2025 OpenAI.
//! This is a distinct reset policy, never an empty-summary fallback. Hosts opt
//! in explicitly and own model binding, persistence, I/O and window installation.
mod metadata;
pub mod reset;
pub mod tools;
mod window;
use super::{accounting::ContextAccounting, checkpoint::ContextCheckpoint};
use crate::{
    model::{ModelError, ModelMessage, ToolDefinition},
    protocol::ModelIdentity,
};
pub use metadata::TokenBudgetContext;
use serde::{Deserialize, Serialize};
pub use window::{TokenBudgetDecision, TokenBudgetTransition, TokenBudgetWindow};

const MAX_MESSAGE_BYTES: usize = 2000;
const DEFAULT_REMINDER: &str = concat!(
    "Your context window is nearly exhausted (only {n_remaining} tokens remaining) and will be automatically reset for you soon. ",
    "Once reset, message items in current context window will be cleared in the new window, but notes and history items will be persistent across windows."
);

/// Trusted resolved host settings. Presence is opt-in; defaults alone do not
/// enable TokenBudget or expose its tools. Values never come from model output.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenBudgetSettings {
    pub reminder_threshold_tokens: Option<u64>,
    pub reminder_message_template: String,
    pub guidance_message: Option<String>,
    pub auto_compact_fallback_prompt: Option<String>,
    pub auto_compact_fallback_buffer_tokens: Option<u64>,
}
impl Default for TokenBudgetSettings {
    fn default() -> Self {
        Self {
            reminder_threshold_tokens: None,
            reminder_message_template: DEFAULT_REMINDER.into(),
            guidance_message: None,
            auto_compact_fallback_prompt: None,
            auto_compact_fallback_buffer_tokens: None,
        }
    }
}

#[derive(Clone)]
pub struct TokenBudgetPolicy {
    settings: TokenBudgetSettings,
}
impl TokenBudgetPolicy {
    pub fn resolve(mut settings: TokenBudgetSettings) -> Result<Self, ModelError> {
        if settings.reminder_threshold_tokens == Some(0)
            || settings.auto_compact_fallback_buffer_tokens == Some(0)
            || settings.reminder_message_template.trim().is_empty()
            || settings.reminder_message_template.len() > MAX_MESSAGE_BYTES
        {
            return Err(ModelError::InvalidRequest);
        }
        settings.guidance_message = settings
            .guidance_message
            .filter(|message| !message.trim().is_empty());
        settings.auto_compact_fallback_prompt = settings
            .auto_compact_fallback_prompt
            .map(|message| message.trim().to_owned())
            .filter(|message| !message.is_empty());
        if settings
            .guidance_message
            .as_ref()
            .is_some_and(|message| message.len() > MAX_MESSAGE_BYTES)
            || settings
                .auto_compact_fallback_prompt
                .as_ref()
                .is_some_and(|message| message.len() > MAX_MESSAGE_BYTES)
            || (settings.auto_compact_fallback_prompt.is_some()
                && settings.auto_compact_fallback_buffer_tokens.is_none())
        {
            return Err(ModelError::InvalidRequest);
        }
        Ok(Self { settings })
    }
    pub fn settings(&self) -> &TokenBudgetSettings {
        &self.settings
    }
    /// Render the pinned ContextWindowGuidance fragment. The host owns its
    /// protocol role and placement in authoritative context, never chat output.
    pub fn guidance_fragment(&self) -> Option<String> {
        self.settings.guidance_message.as_ref().map(|message| {
            format!("<context_window_guidance>\n{message}\n</context_window_guidance>")
        })
    }
    pub fn fallback_buffer_tokens(&self) -> u64 {
        if self.settings.auto_compact_fallback_prompt.is_some() {
            self.settings
                .auto_compact_fallback_buffer_tokens
                .unwrap_or(0)
        } else {
            0
        }
    }
    /// Use the exact injected model and estimator. Scoped usage is supplied by
    /// that estimator (including body-after-prefix), not guessed from bytes here.
    pub fn status(
        &self,
        accounting: &ContextAccounting,
        model: &ModelIdentity,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<TokenBudgetStatus, ModelError> {
        let active = accounting.estimate_window(model, messages, tools, checkpoint)?;
        let scoped = accounting
            .estimator
            .auto_compaction_tokens(active, checkpoint)?;
        let (scope_limit, hard_limit) = match accounting.budget {
            Some(budget) => {
                let (trigger, hard) = budget
                    .limits_for_scope(accounting.estimator.auto_compaction_scope())
                    .map_err(|_| ModelError::InvalidRequest)?;
                (Some(trigger), Some(hard))
            }
            None => {
                if accounting.unknown_window_trigger_tokens == Some(0) {
                    return Err(ModelError::InvalidRequest);
                }
                (accounting.unknown_window_trigger_tokens, None)
            }
        };
        Ok(TokenBudgetStatus::from_usage(
            active,
            scoped,
            scope_limit,
            hard_limit,
            self.fallback_buffer_tokens(),
        ))
    }
}

/// Unknown usage/limits stay None. Known full and scoped limits are independent:
/// a body-only budget may have space while the full model window is exhausted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct TokenBudgetStatus {
    pub active_context_tokens: Option<u64>,
    pub auto_compact_scope_tokens: Option<u64>,
    pub auto_compact_scope_limit: Option<u64>,
    pub full_context_window_limit: Option<u64>,
    pub base_window_tokens_remaining: Option<u64>,
    pub full_context_window_limit_reached: bool,
    pub token_limit_reached: bool,
}
impl TokenBudgetStatus {
    fn from_usage(
        active: Option<u64>,
        scoped: Option<u64>,
        scope_limit: Option<u64>,
        hard_limit: Option<u64>,
        buffer: u64,
    ) -> Self {
        let remaining = |limit: Option<u64>, used: Option<u64>| {
            limit
                .zip(used)
                .map(|(limit, used)| limit.saturating_sub(used))
        };
        let base_window_tokens_remaining = [
            remaining(scope_limit, scoped),
            remaining(hard_limit, active),
        ]
        .into_iter()
        .flatten()
        .min();
        let full_context_window_limit_reached = hard_limit
            .zip(active)
            .is_some_and(|(limit, used)| used >= limit);
        let token_limit_reached = full_context_window_limit_reached
            || scope_limit
                .zip(scoped)
                .is_some_and(|(limit, used)| used >= limit.saturating_add(buffer));
        Self {
            active_context_tokens: active,
            auto_compact_scope_tokens: scoped,
            auto_compact_scope_limit: scope_limit,
            full_context_window_limit: hard_limit,
            base_window_tokens_remaining,
            full_context_window_limit_reached,
            token_limit_reached,
        }
    }
    pub fn remaining_message(&self) -> String {
        match self.base_window_tokens_remaining {
            Some(tokens) => format!("You have {tokens} tokens left in this context window."),
            None => "You have unknown tokens left in this context window.".into(),
        }
    }
}

#[cfg(test)]
mod tests;
