//! Window prefill semantics adapted from Apache-2.0 Codex e363b08c9:
//! first observed input replaces an estimated baseline; output is body growth.
use super::*;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrefillBaseline {
    pub window: Option<Uuid>,
    pub tokens: u64,
    pub observed: bool,
}

/// Scope state belongs to the accounting owner. Reusing this instance preserves
/// a window baseline; constructing a new instance starts with an estimate.
/// Durable owners must restore a baseline before opting into body scope on resume.
pub struct PrefillScopedEstimator {
    inner: Arc<dyn ContextTokenEstimator>,
    baseline: Mutex<Option<PrefillBaseline>>,
}
impl PrefillScopedEstimator {
    pub fn baseline(&self) -> Result<Option<PrefillBaseline>, ModelError> {
        Ok(*self.baseline.lock().map_err(|_| ModelError::Unavailable)?)
    }
    pub fn restore_baseline(&self, baseline: Option<PrefillBaseline>) -> Result<(), ModelError> {
        if baseline.is_some_and(|value| value.window.is_some_and(|id| id.is_nil())) {
            return Err(ModelError::InvalidRequest);
        }
        *self.baseline.lock().map_err(|_| ModelError::Unavailable)? = baseline;
        Ok(())
    }
    pub fn new(inner: Arc<dyn ContextTokenEstimator>) -> Self {
        Self {
            inner,
            baseline: Mutex::new(None),
        }
    }
}
impl ContextTokenEstimator for PrefillScopedEstimator {
    fn auto_compaction_scope(&self) -> AutoCompactionScope {
        AutoCompactionScope::BodyAfterPrefix
    }
    fn auto_compaction_tokens(
        &self,
        active: Option<u64>,
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<Option<u64>, ModelError> {
        let Some(active) = active else {
            return Ok(None);
        };
        let window = checkpoint.map(|value| value.window_id);
        let mut baseline = self.baseline.lock().map_err(|_| ModelError::Unavailable)?;
        if baseline.is_none_or(|value| value.window != window) {
            *baseline = Some(PrefillBaseline {
                window,
                tokens: active,
                observed: false,
            });
        }
        Ok(baseline.map(|value| active.saturating_sub(value.tokens)))
    }
    fn estimate(&self, messages: &[ModelMessage], tools: &[ToolDefinition]) -> Option<u64> {
        self.inner.estimate(messages, tools)
    }
    fn estimate_window(
        &self,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<Option<u64>, ModelError> {
        self.inner.estimate_window(messages, tools, checkpoint)
    }
    fn estimate_compaction(&self, output: &CompactionOutput) -> Option<u64> {
        self.inner.estimate_compaction(output)
    }
    fn text_byte_budget(&self, tokens: u64) -> Option<usize> {
        self.inner.text_byte_budget(tokens)
    }
    fn observe(
        &self,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        usage: ModelUsage,
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<(), ModelError> {
        self.inner.observe(messages, tools, usage, checkpoint)?;
        let Some(tokens) = usage.input_tokens else {
            return Ok(());
        };
        let window = checkpoint.map(|value| value.window_id);
        let mut baseline = self.baseline.lock().map_err(|_| ModelError::Unavailable)?;
        if baseline.is_none_or(|value| value.window != window || !value.observed) {
            *baseline = Some(PrefillBaseline {
                window,
                tokens,
                observed: true,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
