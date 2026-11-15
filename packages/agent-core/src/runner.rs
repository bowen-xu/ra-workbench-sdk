// Adapted from Codex core/src/session/turn.rs model/tool continuation (Apache-2.0).
// Copyright 2025 OpenAI. Research adapters own authorization, durable events and IO.
use crate::{
    model::*,
    protocol::{
        AssistantMessagePhase, EventPayload, FailureCategory, ItemKind, TurnOutcome, TurnPhase,
    },
    resilience::{RetryDecision, RetryPolicy},
};
use std::{collections::HashSet, future::Future, pin::Pin};
use uuid::Uuid;
mod error;
mod output;
mod retry;
pub use error::{InvalidToolOutcomeDiagnostic, RunError, ToolOutcomeDiagnostic};
mod codex_stream_parser;
mod sample;
mod sampling_context;
mod stop_message;
mod stop_output;
mod text;
mod tool_feedback;
mod tools;
pub use sampling_context::{PreparedSamplingContext, SamplingContext, StopHookOutcome, StopHooks};
pub use stop_message::stop_hook_last_assistant_message;
pub use stop_output::{
    StopEvent, StopHandlerOutput, StopHandlerStatus, StopOutputAggregate, StopPromptFragment,
    aggregate_stop_outputs,
};

pub type RunFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, RunError>> + Send + 'a>>;

pub struct ToolOutput {
    pub content: String,
    pub is_error: bool,
}

/// Route presence is independent of permission to execute that route.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolNameResolution {
    Registered,
    NotFound,
    /// A leaf executor has no separate name inventory. Its existing validation
    /// remains authoritative; this value grants no execution permission.
    Unspecified,
}

/// Implementations validate registered schemas and enforce current resource permissions.
/// No shell or business side effects may bypass this adapter. Cancellation/drop must
/// stop owned work or record an explicit reconciliation requirement for started effects.
pub trait ToolExecutor: Send + Sync {
    /// Pure lookup before parsing raw arguments. Must not acquire a grant,
    /// discover remote tools or use authorization state to report NotFound.
    fn resolve_name(&self, _name: &str) -> ToolNameResolution {
        ToolNameResolution::Unspecified
    }
    /// Namespaces are independent identities and must never fall back to a
    /// bare-name handler. Owners must explicitly opt into namespace routing.
    fn resolve_qualified_name(&self, namespace: Option<&str>, name: &str) -> ToolNameResolution {
        if namespace.is_none() {
            self.resolve_name(name)
        } else {
            ToolNameResolution::NotFound
        }
    }
    /// Shared execution is opt-in per registered tool. Calls without this
    /// capability hold the exclusive execution gate, including against reads.
    fn supports_parallel(&self, _call: &ToolCall) -> bool {
        false
    }
    /// True only when dropping the execution future cannot abandon started
    /// effects or retained results. Hosts otherwise signal the resource owner
    /// and await its teardown/result, even after model cancellation. This flag
    /// does not send that signal; the host must own cancellation or the handler
    /// must provide bounded completion. Dropping a run retains the owner/recovery
    /// obligation described by this trait.
    fn cancellation_safe_to_drop(&self, _call: &ToolCall) -> bool {
        false
    }
    /// Revoke an unstarted permission/approval wait after cancellation. This
    /// notification must not drop started IO or release retained results; the
    /// caller still awaits authorize_and_execute and its owner's teardown.
    fn cancel_pending(&self, _call: ToolCall) -> RunFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    /// Optional registered host finalization work before a natural end. It runs
    /// through the same durable tool/result path and bounded model continuation.
    /// The owner must return None after its attempt; errors must not cause an
    /// unbounded finalization/retry loop.
    fn finalization_call(&self) -> RunFuture<'_, Option<ToolCall>> {
        Box::pin(async { Ok(None) })
    }
    /// Called by a registered finalization tool after its durable intent. A
    /// native owner may seal its writer grant and hand off a quiescent lease.
    fn release_for_finalization(&self) -> RunFuture<'_, bool> {
        Box::pin(async { Ok(false) })
    }
    /// ToolArguments is returned to the model without execution. Other errors
    /// reject this item; earlier accepted calls still finish and retain results.
    fn validate(&self, call: &ToolCall) -> Result<(), RunError>;
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput>;
    /// False only when this exact executor has no post-result owner work to
    /// acknowledge. Unknown routes stay conservative and require a receipt.
    fn requires_result_receipt(&self, _call: &ToolCall) -> bool {
        true
    }
    /// A child-creation owner may provide its immutable intent after validation.
    /// The runner durably records it before admitting the tool to execution.
    fn child_creation_intent(
        &self,
        _call: &ToolCall,
    ) -> Option<crate::conversation::CreateBoundConversation> {
        None
    }
    /// Called only after the full tool-result item is durably acknowledged.
    /// Resource owners may release retained results here. This must not execute
    /// the tool again; failure requires recovery and prevents model continuation.
    /// Tools without retained resources need no acknowledgement work.
    fn result_committed(&self, _call: ToolCall) -> RunFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

/// Completion means durable acknowledgement, not merely enqueueing a UI message.
/// The caller must already have committed TurnStarted and the submitted user input.
pub trait TurnEventSink: Send + Sync {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()>;
}
pub trait RunIdSource: Send + Sync {
    fn next_id(&self) -> Uuid;
}

/// Host-owned backoff for transient model failures. The core decides whether a
/// retry is safe and how long to wait; the host supplies the scheduler so the
/// shared crate stays independent of Tokio or another async runtime.
pub trait RetryWait: Send + Sync {
    fn wait(&self, delay_ms: u64) -> RunFuture<'_, ()>;
}

struct NoRetryWait;
impl RetryWait for NoRetryWait {
    fn wait(&self, _: u64) -> RunFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

/// Supplies same-turn input only after its user items are durable. Implementations
/// serialize admission with the finishing inspection or `finish_if_empty` drain:
/// an empty finishing lookup seals the turn, so concurrent input is rejected or
/// queued for the next turn, never lost.
/// The host closes admission when a run fails or is dropped. This port must not
/// execute models/tools or change the frozen model/context authorization.
pub trait TurnInputSource: Send + Sync {
    /// Inspect without consuming input or sealing admission. A later finishing
    /// inspection is still required to fence concurrent arrivals.
    fn has_pending(&self, turn_id: Uuid) -> RunFuture<'_, bool>;
    /// Inspect without consuming or committing user history. When empty, seal
    /// admission atomically with the lookup. A true result reserves pending input
    /// for this runner until drain; it must remain pending through compaction.
    fn has_pending_or_seal(&self, turn_id: Uuid) -> RunFuture<'_, bool>;
    /// Stop must fence further arrivals without consuming inputs accepted
    /// while its hook was running. Unsupported hosts fail closed.
    fn seal_for_stop(&self, _turn_id: Uuid) -> RunFuture<'_, ()> {
        Box::pin(async { Err(RunError::EventSink) })
    }
    fn drain(&self, turn_id: Uuid, finish_if_empty: bool) -> RunFuture<'_, Vec<ModelMessage>>;
}

struct NoAdditionalInput;
impl TurnInputSource for NoAdditionalInput {
    fn seal_for_stop(&self, _: Uuid) -> RunFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn has_pending(&self, _: Uuid) -> RunFuture<'_, bool> {
        Box::pin(async { Ok(false) })
    }
    fn has_pending_or_seal(&self, _: Uuid) -> RunFuture<'_, bool> {
        Box::pin(async { Ok(false) })
    }
    fn drain(&self, _: Uuid, _: bool) -> RunFuture<'_, Vec<ModelMessage>> {
        Box::pin(async { Ok(Vec::new()) })
    }
}

#[derive(Clone, Copy)]
pub struct RunLimits {
    /// None follows the Codex main-turn loop until natural completion or cancellation.
    /// Explicitly bounded workflows and child tasks may supply a finite allowance.
    pub model_calls: Option<usize>,
    pub tool_calls: Option<usize>,
    pub output_bytes: Option<usize>,
    /// Maximum bytes in one tool result, not an aggregate turn allowance.
    pub tool_output_bytes: usize,
    pub response: StreamLimits,
}

impl RunLimits {
    /// Child admission can only narrow an existing finite call allowance.
    pub fn with_call_budget(mut self, model_calls: usize, tool_calls: usize) -> Self {
        self.model_calls = Some(
            self.model_calls
                .map_or(model_calls, |max| max.min(model_calls)),
        );
        self.tool_calls = Some(
            self.tool_calls
                .map_or(tool_calls, |max| max.min(tool_calls)),
        );
        self
    }
}

pub struct TurnRunResult {
    pub responses: Vec<ModelResponse>,
    pub messages: Vec<ModelMessage>,
}

pub struct TurnRunner<'a> {
    pub transport: &'a dyn ModelTransport,
    pub tools: &'a dyn ToolExecutor,
    pub sink: &'a dyn TurnEventSink,
    pub ids: &'a dyn RunIdSource,
    pub limits: RunLimits,
}

impl TurnRunner<'_> {
    /// Each validated completed item's intent is durable before execution. A
    /// later stream failure retains completed facts and drains owned tools before
    /// retry; ambiguous tool effects block further model sampling.
    pub async fn run(
        &self,
        turn_id: Uuid,
        request: ModelRequest,
    ) -> Result<TurnRunResult, RunError> {
        self.run_with_input(turn_id, request, &NoAdditionalInput)
            .await
    }

    pub async fn run_with_input(
        &self,
        turn_id: Uuid,
        request: ModelRequest,
        input: &dyn TurnInputSource,
    ) -> Result<TurnRunResult, RunError> {
        self.run_with_retry_wait(turn_id, request, input, &NoRetryWait)
            .await
    }

    /// Same bounded runner with host-controlled transient retry backoff.
    pub async fn run_with_retry_wait(
        &self,
        turn_id: Uuid,
        request: ModelRequest,
        input: &dyn TurnInputSource,
        retry_wait: &dyn RetryWait,
    ) -> Result<TurnRunResult, RunError> {
        self.run_with_sampling_context(turn_id, request, input, retry_wait, None)
            .await
    }

    /// One runner/terminal boundary; the host injects context replacement at safe
    /// sampling boundaries without creating another retry or tool loop.
    pub async fn run_with_sampling_context(
        &self,
        turn_id: Uuid,
        request: ModelRequest,
        input: &dyn TurnInputSource,
        retry_wait: &dyn RetryWait,
        context: Option<&dyn SamplingContext>,
    ) -> Result<TurnRunResult, RunError> {
        let result = self
            .run_inner(turn_id, request, input, retry_wait, context)
            .await;
        let outcome = match &result {
            Ok(_) => TurnOutcome::Completed,
            Err(error) if error.is_event_sink() => return result,
            Err(RunError::Model(ModelError::Canceled)) => TurnOutcome::Canceled,
            Err(_) => TurnOutcome::Failed,
        };
        if let Err(error) = &result
            && outcome == TurnOutcome::Failed
        {
            self.sink
                .emit(EventPayload::TurnFailed {
                    turn_id,
                    error: error.to_string(),
                    category: error.failure_category(),
                })
                .await?;
        }
        self.sink
            .emit(EventPayload::TurnFinished { turn_id, outcome })
            .await?;
        result
    }

    async fn run_inner(
        &self,
        turn_id: Uuid,
        mut request: ModelRequest,
        input: &dyn TurnInputSource,
        retry_wait: &dyn RetryWait,
        context: Option<&dyn SamplingContext>,
    ) -> Result<TurnRunResult, RunError> {
        if self.limits.model_calls == Some(0)
            || self.limits.output_bytes == Some(0)
            || self.limits.tool_output_bytes == 0
        {
            return Err(RunError::Budget);
        }
        let policy = if self.transport.tool_output_history_prepared() {
            None
        } else {
            self.transport.tool_output_policy()
        };
        if !crate::model::tool_output::project_tool_results(
            &mut request.messages,
            policy,
            self.limits.tool_output_bytes,
        ) {
            return Err(RunError::Budget);
        }
        let mut responses = Vec::new();
        let mut used_calls = HashSet::new();
        let mut tool_count = 0usize;
        let mut output_bytes = 0usize;
        let mut usage = sample::TurnUsage::new();
        let mut prepare_sampling = false;
        let mut model_needs_follow_up = false;
        let mut can_drain_pending_input = false;
        let mut failed_attempts = 0_u8;
        let mut model_calls = 0usize;
        let mut input_sealed = false;
        let mut stop_hook_active = false;
        loop {
            if self
                .limits
                .model_calls
                .is_some_and(|max| model_calls >= max)
            {
                return Err(RunError::Budget);
            }
            model_calls = model_calls.checked_add(1).ok_or(RunError::Budget)?;
            // Initial sampling (and its safe retries) owns the already admitted
            // fresh input. Pending steer, including input accepted during a
            // pre-turn compaction, waits for the first response boundary.
            if prepare_sampling {
                let prepared =
                    sampling_context::prepare(context, turn_id, request, model_needs_follow_up)
                        .await?;
                can_drain_pending_input = !prepared.compacted || !model_needs_follow_up;
                request = prepared.request;
                if !crate::model::tool_output::bound_tool_results(
                    &mut request.messages,
                    self.limits.tool_output_bytes,
                ) {
                    return Err(RunError::Budget);
                }
                prepare_sampling = false;
            }
            if !input_sealed && can_drain_pending_input && failed_attempts == 0 {
                append_input(&mut request, input.drain(turn_id, false).await?)?;
            }
            request.validate(self.transport.capabilities())?;
            self.sink
                .emit(EventPayload::PhaseChanged {
                    turn_id,
                    phase: TurnPhase::RunningModel,
                })
                .await?;
            if model_calls > 1 {
                request.request_id = self.ids.next_id();
            }
            self.sink
                .emit(EventPayload::ModelRequestStarted {
                    turn_id,
                    attempt_id: request.request_id,
                    model: request.model.clone(),
                })
                .await?;
            self.sink
                .emit(EventPayload::ModelOutputInterleavingStarted {
                    turn_id,
                    attempt_id: request.request_id,
                })
                .await?;
            let can_follow_up = self.limits.model_calls.is_none_or(|max| model_calls < max);
            let sample_history_start = request.messages.len();
            let response = match self
                .sample(
                    turn_id,
                    &mut request,
                    &mut used_calls,
                    &mut tool_count,
                    &mut output_bytes,
                    &mut failed_attempts,
                    &mut usage,
                    can_follow_up,
                    context,
                )
                .await
            {
                Ok(response) => response,
                Err(sample::SampleError {
                    error: RunError::Model(error),
                    model_failed: true,
                }) => {
                    self.retry_model_failure(
                        turn_id,
                        request.request_id,
                        error,
                        &mut failed_attempts,
                        retry_wait,
                        can_follow_up,
                    )
                    .await?;
                    if request.messages[sample_history_start..]
                        .iter()
                        .any(|message| matches!(message, ModelMessage::ToolResult { .. }))
                    {
                        // Completed items survived this failed stream. Their
                        // committed tool results may request a context rollover;
                        // prepare it before retrying without draining new steer.
                        prepare_sampling = true;
                        model_needs_follow_up = true;
                    }
                    continue;
                }
                Err(failure) => return Err(failure.error),
            };
            failed_attempts = 0;
            model_needs_follow_up =
                !response.tool_calls.is_empty() || response.end_turn == Some(false);
            responses.push(response);
            prepare_sampling = true;
            if model_needs_follow_up {
                continue;
            }
            if let Some(hooks) = context.and_then(SamplingContext::stop_hooks) {
                if !input_sealed && input.has_pending(turn_id).await? {
                    continue;
                }
                // This response is the one immediately preceding the Stop
                // boundary; older assistant messages in the request are not it.
                let current_response = responses.last().ok_or(ModelError::InvalidStream)?;
                match hooks
                    .run(turn_id, &request, current_response, stop_hook_active)
                    .await?
                {
                    StopHookOutcome::Continue => {}
                    StopHookOutcome::Stop => {
                        // Stop takes precedence over new steering and sampling.
                        // Seal without consuming accepted input, then let the
                        // host finish owned delivery before the terminal event.
                        if !input_sealed {
                            input.seal_for_stop(turn_id).await?;
                        }
                        while let Some(call) = self.tools.finalization_call().await? {
                            let before = request.messages.len();
                            self.finalize(
                                turn_id,
                                call,
                                &mut request,
                                &mut used_calls,
                                &mut tool_count,
                                true,
                                context,
                            )
                            .await?;
                            if request.messages[before..].iter().any(|message| {
                                matches!(message, ModelMessage::ToolResult { is_error: true, .. })
                            }) {
                                return Err(RunError::HostFinalizationFailed);
                            }
                        }
                        return Ok(TurnRunResult {
                            responses,
                            messages: request.messages,
                        });
                    }
                    StopHookOutcome::FollowUp(message) => {
                        append_input(&mut request, vec![message])?;
                        stop_hook_active = true;
                        continue;
                    }
                }
            }
            // This lookup is an atomic admission fence, after all accepted tool
            // results. Pending steer wins before a finalizer can revoke writes.
            if !input_sealed {
                if input.has_pending_or_seal(turn_id).await? {
                    continue;
                }
                input_sealed = true;
            }
            if let Some(call) = self.tools.finalization_call().await? {
                self.finalize(
                    turn_id,
                    call,
                    &mut request,
                    &mut used_calls,
                    &mut tool_count,
                    can_follow_up,
                    context,
                )
                .await?;
                model_needs_follow_up = true;
                continue;
            }
            if let Some(context) = context {
                context.observe_natural_end(turn_id, &request).await?;
            }
            return Ok(TurnRunResult {
                responses,
                messages: request.messages,
            });
        }
    }
}

fn append_input(request: &mut ModelRequest, messages: Vec<ModelMessage>) -> Result<(), RunError> {
    if messages
        .iter()
        .any(|message| !matches!(message, ModelMessage::User { .. }))
    {
        // A host must not impersonate assistant/tool history through steering.
        return Err(RunError::EventSink);
    }
    request.messages.extend(messages);
    Ok(())
}

fn sum_usage(total: Option<u64>, next: Option<u64>) -> Result<Option<u64>, RunError> {
    match (total, next) {
        (Some(total), Some(next)) => total
            .checked_add(next)
            .filter(|value| *value <= 9_007_199_254_740_991)
            .map(Some)
            .ok_or(RunError::Budget),
        _ => Ok(None),
    }
}
