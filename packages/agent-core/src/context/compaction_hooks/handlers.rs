//! Concurrent hook dispatch adapted from Codex hooks/src/engine/dispatcher.rs
//! and events/session_start.rs at e363b08c9175ac1cbe5893615dd2cb9ddf95043b.
//! Apache-2.0 / Copyright 2025 OpenAI. No task spawning or command authorization.
use super::*;
use futures_util::{StreamExt, stream::FuturesUnordered};
use std::{collections::HashSet, sync::Arc};

pub struct CompactionHookHandler {
    /// Stable configured identity, separate from the window/operation identity.
    pub id: Uuid,
    pub stage: CompactionHookStage,
    pub hooks: Arc<dyn CompactionHooks>,
}

/// Status-only callback; must not launch background work or retain hook output.
/// Durable storage remains the host's responsibility, not proven by notification.
pub trait HookHandlerObserver: Send + Sync {
    fn notify(
        &self,
        handler_id: Uuid,
        request: &CompactionHookRequest,
        notification: CompactionHookNotification,
    );
}

#[derive(Debug, thiserror::Error)]
#[error("invalid or duplicate compaction hook handler identity")]
pub struct InvalidHookHandlers;

/// One existing task-owned hook invocation containing concurrent handlers.
/// Dropping its future drops every handler future; no detached execution exists.
pub struct ConcurrentCompactionHooks {
    handlers: Vec<CompactionHookHandler>,
    observer: Arc<dyn HookHandlerObserver>,
}

impl ConcurrentCompactionHooks {
    pub fn new(
        handlers: Vec<CompactionHookHandler>,
        observer: Arc<dyn HookHandlerObserver>,
    ) -> Result<Self, InvalidHookHandlers> {
        let mut ids = HashSet::new();
        // Application concurrency bound, not a claimed upstream constant.
        if handlers.len() > 32
            || handlers
                .iter()
                .any(|handler| handler.id.is_nil() || !ids.insert(handler.id))
        {
            return Err(InvalidHookHandlers);
        }
        Ok(Self { handlers, observer })
    }

    async fn execute(
        &self,
        request: CompactionHookRequest,
        collector: Option<Arc<dyn HookHandlerObserver>>,
    ) -> CompactionHookResult {
        let mut pending = FuturesUnordered::new();
        for (index, handler) in self.handlers.iter().enumerate().filter(|(_, handler)| {
            handler.stage == request.stage && handler.hooks.accepts_request(&request)
        }) {
            let request = request.clone();
            let collector = collector.clone();
            pending.push(async move {
                let mut guard = HandlerGuard::start(
                    handler,
                    self.observer.as_ref(),
                    collector.as_deref(),
                    &request,
                );
                let result = handler.hooks.run_with_context(request.clone()).await;
                guard.complete(result.outcome);
                (index, result)
            });
        }
        let mut results = Vec::new();
        while let Some(result) = pending.next().await {
            results.push(result);
        }
        results.sort_by_key(|(index, _)| *index);
        let mut outcome = CompactionHookOutcome::Continue;
        let mut contexts = Vec::new();
        for (_, result) in results {
            match result.outcome {
                CompactionHookOutcome::Canceled => {
                    return CompactionHookResult::without_context(CompactionHookOutcome::Canceled);
                }
                CompactionHookOutcome::Stop => outcome = CompactionHookOutcome::Stop,
                CompactionHookOutcome::Failed => continue,
                CompactionHookOutcome::Continue => {}
            }
            // Pre/Post outputs cannot become SessionStart authority even when
            // a custom host accidentally supplies context at the wrong stage.
            if request.stage == CompactionHookStage::SessionStartCompact {
                contexts.extend(result.additional_contexts);
            }
        }
        // Individual failures are observed separately, not a veto or a reason
        // to discard successful context. Aggregate behavior follows upstream.
        CompactionHookResult {
            outcome,
            additional_contexts: contexts,
        }
    }
}

impl CompactionHooks for ConcurrentCompactionHooks {
    fn notify(&self, _: &CompactionHookRequest, _: CompactionHookNotification) {}
    fn run(&self, request: CompactionHookRequest) -> CompactionHookFuture<'_> {
        Box::pin(async move { self.execute(request, None).await.outcome })
    }
    fn run_with_context(&self, request: CompactionHookRequest) -> CompactionHookResultFuture<'_> {
        Box::pin(self.execute(request, None))
    }
    fn handler_ids(&self, stage: CompactionHookStage) -> Vec<Uuid> {
        self.handlers
            .iter()
            .filter(|handler| handler.stage == stage)
            .map(|handler| handler.id)
            .collect()
    }
    fn handler_ids_for(&self, request: &CompactionHookRequest) -> Vec<Uuid> {
        self.handlers
            .iter()
            .filter(|handler| {
                handler.stage == request.stage && handler.hooks.accepts_request(request)
            })
            .map(|handler| handler.id)
            .collect()
    }
    fn validate_request(&self, request: &CompactionHookRequest) -> Result<(), HookContextError> {
        for handler in self.handlers.iter().filter(|handler| {
            handler.stage == request.stage && handler.hooks.accepts_request(request)
        }) {
            handler.hooks.validate_request(request)?;
        }
        Ok(())
    }
    fn run_with_handler_observer(
        &self,
        request: CompactionHookRequest,
        observer: Arc<dyn HookHandlerObserver>,
    ) -> CompactionHookResultFuture<'_> {
        Box::pin(self.execute(request, Some(observer)))
    }
}

struct HandlerGuard<'a> {
    handler: &'a CompactionHookHandler,
    observer: &'a dyn HookHandlerObserver,
    collector: Option<&'a dyn HookHandlerObserver>,
    request: &'a CompactionHookRequest,
    completed: bool,
}
impl<'a> HandlerGuard<'a> {
    fn start(
        handler: &'a CompactionHookHandler,
        observer: &'a dyn HookHandlerObserver,
        collector: Option<&'a dyn HookHandlerObserver>,
        request: &'a CompactionHookRequest,
    ) -> Self {
        handler
            .hooks
            .notify(request, CompactionHookNotification::Started);
        observer.notify(handler.id, request, CompactionHookNotification::Started);
        if let Some(collector) = collector {
            collector.notify(handler.id, request, CompactionHookNotification::Started);
        }
        Self {
            handler,
            observer,
            collector,
            request,
            completed: false,
        }
    }
    fn complete(&mut self, outcome: CompactionHookOutcome) {
        let notification = CompactionHookNotification::Completed(outcome);
        self.handler.hooks.notify(self.request, notification);
        self.observer
            .notify(self.handler.id, self.request, notification);
        if let Some(collector) = self.collector {
            collector.notify(self.handler.id, self.request, notification);
        }
        self.completed = true;
    }
}
impl Drop for HandlerGuard<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.complete(CompactionHookOutcome::Canceled);
        }
    }
}

#[cfg(test)]
mod tests;
