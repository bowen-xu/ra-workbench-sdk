//! Active usage follows Codex history.rs get_total_token_usage, e363b08c9
//! (Apache-2.0). Local snapshots bind the observation to an exact normalized
//! prefix, tools and window; cumulative billed usage never enters this state.
use super::*;
use std::sync::Mutex;
use uuid::Uuid;

struct Baseline {
    messages: Vec<ModelMessage>,
    tools: Vec<ToolDefinition>,
    window: Option<Uuid>,
    total: u64,
}

/// Native composition opts in when provider usage includes the sampled window
/// and its output. Missing usage, changed prefix or new window uses the injected
/// estimator. State lives with this transport; resume needs a durable owner.
pub struct ServerObservedEstimator {
    inner: Arc<dyn ContextTokenEstimator>,
    baseline: Mutex<Option<Baseline>>,
}
impl ServerObservedEstimator {
    pub fn new(inner: Arc<dyn ContextTokenEstimator>) -> Self {
        Self {
            inner,
            baseline: Mutex::new(None),
        }
    }
}
impl ContextTokenEstimator for ServerObservedEstimator {
    fn estimate(&self, messages: &[ModelMessage], tools: &[ToolDefinition]) -> Option<u64> {
        self.inner.estimate(messages, tools)
    }
    fn estimate_compaction(&self, output: &CompactionOutput) -> Option<u64> {
        self.inner.estimate_compaction(output)
    }
    fn text_byte_budget(&self, tokens: u64) -> Option<usize> {
        self.inner.text_byte_budget(tokens)
    }
    fn estimate_window(
        &self,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<Option<u64>, ModelError> {
        let baseline = self.baseline.lock().map_err(|_| ModelError::Unavailable)?;
        if let Some(saved) = baseline.as_ref().filter(|saved| {
            saved.window == checkpoint.map(|window| window.window_id)
                && saved.tools == tools
                && messages.starts_with(&saved.messages)
        }) {
            // Output tokens already cover the final model-generated item.
            // Only locally appended tool results/steer are estimated here;
            // tool schemas and opaque state were part of the observed input.
            return self
                .inner
                .estimate(&messages[saved.messages.len()..], &[])
                .map(|tail| {
                    saved
                        .total
                        .checked_add(tail)
                        .ok_or(ModelError::BudgetExceeded)
                })
                .transpose();
        }
        self.inner.estimate_window(messages, tools, checkpoint)
    }
    fn observe(
        &self,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        usage: ModelUsage,
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<(), ModelError> {
        let total = usage
            .input_tokens
            .zip(usage.output_tokens)
            .map(|(input, output)| input.checked_add(output).ok_or(ModelError::BudgetExceeded))
            .transpose()?;
        let mut baseline = self.baseline.lock().map_err(|_| ModelError::Unavailable)?;
        *baseline = total.map(|total| Baseline {
            messages: messages.to_vec(),
            tools: tools.to_vec(),
            window: checkpoint.map(|window| window.window_id),
            total,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests;
