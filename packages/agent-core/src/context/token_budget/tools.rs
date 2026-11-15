//! Adapted from Codex tools/handlers/{new_context_window,get_context_remaining}
//! and their specs (Apache-2.0), e363b08c9175ac1cbe5893615dd2cb9ddf95043b.
//! Copyright 2025 OpenAI. State and accounting remain with the admitted host.
use crate::{
    model::{ToolCall, ToolDefinition},
    runner::{RunError, RunFuture, ToolExecutor, ToolOutput},
    tool_registry::ToolRegistration,
};
use serde_json::json;

pub const NEW_CONTEXT: &str = "new_context";
pub const GET_CONTEXT_REMAINING: &str = "get_context_remaining";

/// Bound to an admitted exact-model runtime by the composition owner. Requests
/// only set a flag; the existing sampling owner installs any replacement later.
/// Remaining is the unbuffered active budget, not billed/cumulative token usage.
pub trait TokenBudgetToolRuntime: Send + Sync {
    fn request_new_window(&self) -> RunFuture<'_, ()>;
    fn tokens_remaining(&self) -> RunFuture<'_, Option<u64>>;
}

/// Absence is disabled: no model-visible schemas and no callable handlers.
/// This opt-in is native composition, never a renderer capability assertion.
pub struct TokenBudgetTools<'a> {
    runtime: Option<&'a dyn TokenBudgetToolRuntime>,
}
impl<'a> TokenBudgetTools<'a> {
    pub fn new(runtime: Option<&'a dyn TokenBudgetToolRuntime>) -> Self {
        Self { runtime }
    }
    pub fn registration(&self) -> ToolRegistration<'_> {
        let definitions = if self.runtime.is_some() {
            [
                (NEW_CONTEXT, "Start a new context window. Does not clear, reset, or otherwise affect environment state."),
                (GET_CONTEXT_REMAINING, "Get the remaining tokens in the current context window."),
            ].into_iter().map(|(name, description)| ToolDefinition {
                namespace: None,
                name: name.into(), description: description.into(),
                parameters: json!({"type":"object","properties":{},"additionalProperties":false}),
            }).collect()
        } else {
            vec![]
        };
        ToolRegistration::new(definitions, self)
    }
}
impl ToolExecutor for TokenBudgetTools<'_> {
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        if self.runtime.is_none()
            || !matches!(call.name.as_str(), NEW_CONTEXT | GET_CONTEXT_REMAINING)
        {
            return Err(RunError::ToolRejected);
        }
        if !call
            .arguments
            .as_object()
            .is_some_and(|args| args.is_empty())
        {
            return Err(RunError::ToolArguments(
                "This context tool takes an empty object and no other arguments.".into(),
            ));
        }
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            self.validate(&call)?;
            let runtime = self.runtime.ok_or(RunError::ToolRejected)?;
            let content = match call.name.as_str() {
                NEW_CONTEXT => {
                    runtime.request_new_window().await?;
                    "A new context window will start without summarizing conversation history."
                        .into()
                }
                GET_CONTEXT_REMAINING => match runtime.tokens_remaining().await? {
                    Some(tokens) => {
                        format!("You have {tokens} tokens left in this context window.")
                    }
                    None => "You have unknown tokens left in this context window.".into(),
                },
                _ => return Err(RunError::ToolRejected),
            };
            Ok(ToolOutput {
                content,
                is_error: false,
            })
        })
    }
}

#[cfg(test)]
mod tests;
