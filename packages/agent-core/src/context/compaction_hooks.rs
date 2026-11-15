//! Compaction hook boundary adapted from OpenAI Codex (Apache-2.0), commit
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b, hooks/src/events/compact.rs
//! and core/src/hook_runtime.rs. Copyright 2025 OpenAI.
//! Host execution and audit storage remain injected; hook output is never a summary.

use super::compaction_strategy::CompactionPhase;
use crate::protocol::ModelIdentity;
use serde::Deserialize;
use std::{future::Future, pin::Pin};
use uuid::Uuid;

mod handlers;
mod output;
pub use handlers::{
    CompactionHookHandler, ConcurrentCompactionHooks, HookHandlerObserver, InvalidHookHandlers,
};
pub use output::{
    CompactionHookResult, CompactionHookResultFuture, HookContextError, HookContextPreparation,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactionHookStage {
    PreCompact,
    PostCompact,
    SessionStartCompact,
}

/// No credentials or conversation contents enter the hook request. Hosts may
/// resolve authorized workspace/transcript handles from these stable identities.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactionHookRequest {
    pub operation_id: Uuid,
    pub conversation_id: Uuid,
    pub turn_id: Uuid,
    pub phase: CompactionPhase,
    pub model: ModelIdentity,
    pub stage: CompactionHookStage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactionHookOutcome {
    Continue,
    Stop,
    Failed,
    Canceled,
}

impl CompactionHookOutcome {
    /// Only successful structured `continue=false` stops the turn. Unsupported
    /// decision/block and ordinary execution failures are not compaction vetoes.
    /// Output text is deliberately not retained, logged or appended to history.
    pub fn from_process_output(exit_code: Option<i32>, stdout: &str) -> Self {
        if exit_code != Some(0) {
            return Self::Failed;
        }
        if stdout.trim().is_empty() {
            return Self::Continue;
        }
        #[derive(Deserialize)]
        struct Output {
            #[serde(rename = "continue")]
            continue_execution: Option<bool>,
        }
        match serde_json::from_str::<Output>(stdout) {
            Ok(output) if output.continue_execution == Some(false) => Self::Stop,
            Ok(_) => Self::Continue,
            Err(_) if stdout.trim_start().starts_with(['{', '[']) => Self::Failed,
            Err(_) => Self::Continue,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactionHookNotification {
    Started,
    Completed(CompactionHookOutcome),
}

pub type CompactionHookFuture<'a> =
    Pin<Box<dyn Future<Output = CompactionHookOutcome> + Send + 'a>>;

/// Task-owned host port, independent of supplier strategy and model transport.
/// Dropping `run` must release owned I/O/processes; detached runners are forbidden.
/// `notify` receives identities/status only and must not launch background work.
pub trait CompactionHooks: Send + Sync {
    fn notify(&self, request: &CompactionHookRequest, notification: CompactionHookNotification);
    fn run(&self, request: CompactionHookRequest) -> CompactionHookFuture<'_>;

    /// Context-bearing hosts use the same task-owned execution path. Legacy
    /// hosts return no context; notification/audit still records status only.
    fn run_with_context(&self, request: CompactionHookRequest) -> CompactionHookResultFuture<'_> {
        Box::pin(async move { CompactionHookResult::without_context(self.run(request).await) })
    }

    /// Frozen configured identities for task-owned durable admission.
    fn handler_ids(&self, _: CompactionHookStage) -> Vec<Uuid> {
        vec![]
    }

    /// Selection must depend only on the frozen request and handler config.
    /// The same predicate is used for durable admission and dispatch.
    fn accepts_request(&self, _: &CompactionHookRequest) -> bool {
        true
    }

    fn handler_ids_for(&self, request: &CompactionHookRequest) -> Vec<Uuid> {
        self.handler_ids(request.stage)
    }

    /// Validate selected handlers before the host records admission.
    /// This must only inspect already-loaded authority and perform no I/O.
    fn validate_request(&self, _: &CompactionHookRequest) -> Result<(), HookContextError> {
        Ok(())
    }

    /// A per-invocation status collector. Storage is awaited by the task after
    /// execution or cancellation; callbacks must never perform database I/O.
    fn run_with_handler_observer(
        &self,
        request: CompactionHookRequest,
        _: std::sync::Arc<dyn HookHandlerObserver>,
    ) -> CompactionHookResultFuture<'_> {
        self.run_with_context(request)
    }

    /// Await task-owned context storage before publishing completion/context.
    /// Storage failures are distinct from ordinary command failures.
    fn prepare_context(
        &self,
        _: CompactionHookRequest,
        result: CompactionHookResult,
    ) -> HookContextPreparation<'_> {
        Box::pin(async move { Ok(result) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_successful_continue_false_stops_compaction() {
        let parse = CompactionHookOutcome::from_process_output;
        assert_eq!(
            parse(Some(0), r#"{"continue":false}"#),
            CompactionHookOutcome::Stop
        );
        assert_eq!(
            parse(Some(0), r#"{"decision":"block"}"#),
            CompactionHookOutcome::Continue
        );
        assert_eq!(
            parse(Some(1), r#"{"continue":false}"#),
            CompactionHookOutcome::Failed
        );
        assert_eq!(parse(None, ""), CompactionHookOutcome::Failed);
        assert_eq!(
            parse(Some(0), "{invalid output}"),
            CompactionHookOutcome::Failed
        );
        assert_eq!(
            parse(Some(0), "plain output"),
            CompactionHookOutcome::Continue
        );
        assert_eq!(parse(Some(0), ""), CompactionHookOutcome::Continue);
    }
}
