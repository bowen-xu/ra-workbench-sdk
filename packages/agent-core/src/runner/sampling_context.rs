//! Sampling boundary adapted from OpenAI Codex (Apache-2.0), commit
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b core/src/session/turn.rs.
//! Copyright 2025 OpenAI. Native adapters own compaction I/O and checkpoint CAS.
use super::*;

pub struct PreparedSamplingContext {
    pub request: ModelRequest,
    /// True only after the replacement window has been installed successfully.
    pub compacted: bool,
}

/// Host-owned stop hook execution. Follow-up input must already be durably
/// recorded with its hook provenance before it is returned to the runner.
pub trait StopHooks: Send + Sync {
    fn run<'a>(
        &'a self,
        turn_id: Uuid,
        request: &'a ModelRequest,
        response: &'a ModelResponse,
        stop_hook_active: bool,
    ) -> RunFuture<'a, StopHookOutcome>;
}

pub enum StopHookOutcome {
    Continue,
    /// Codex `continue=false`: finish without another model sample.
    Stop,
    FollowUp(ModelMessage),
}

/// Observes successful responses and complete tool batches, prepares follow-up
/// sampling, and observes a sealed natural end. These callbacks never execute
/// tools or drain the input queue. Failure uses this same durable turn owner.
pub trait SamplingContext: Send + Sync {
    /// Stop hooks first run before the final admission fence and may run again
    /// after a finalizer continuation. No hook is installed by default; hosts
    /// own command execution, cancellation and durable output.
    fn stop_hooks(&self) -> Option<&dyn StopHooks> {
        None
    }
    /// Canonical item history is available before its tool can dispatch. This
    /// lightweight observer seeds live context queries; it must not establish a
    /// response-usage baseline or sample/compact/drain the input queue. It also
    /// restores the full live view after response accounting when tool results
    /// were already observed during the stream.
    fn observe_item<'a>(&'a self, _turn_id: Uuid, _request: &'a ModelRequest) -> RunFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    /// Final successful response has no tools and a finishing drain found no
    /// pending input. Admission is sealed, but TurnFinished is not committed.
    /// Native owners can record terminal context contributors here without
    /// sampling, compacting, executing tools or consuming the queue again.
    /// Failed streams and exhausted tool/model budgets never reach this hook.
    fn observe_natural_end<'a>(
        &'a self,
        _turn_id: Uuid,
        _request: &'a ModelRequest,
    ) -> RunFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    /// Request includes the just-completed assistant message, before tools or
    /// pending input are appended. Uses this response's usage, never turn sums.
    fn observe_response<'a>(
        &'a self,
        _turn_id: Uuid,
        _request: &'a ModelRequest,
        _response: &'a ModelResponse,
    ) -> RunFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    /// Called only after a tool result and any executor receipt are committed and
    /// appended, before a conflicting successor enters the execution gate.
    fn observe_tool_result<'a>(
        &'a self,
        _turn_id: Uuid,
        _request: &'a ModelRequest,
    ) -> RunFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    fn prepare(
        &self,
        turn_id: Uuid,
        request: ModelRequest,
        model_needs_follow_up: bool,
    ) -> RunFuture<'_, PreparedSamplingContext>;
}

pub(super) async fn prepare(
    context: Option<&dyn SamplingContext>,
    turn_id: Uuid,
    request: ModelRequest,
    model_needs_follow_up: bool,
) -> Result<PreparedSamplingContext, RunError> {
    let Some(context) = context else {
        return Ok(PreparedSamplingContext {
            request,
            compacted: false,
        });
    };
    let binding = request.model.clone();
    let tools = request.tools.clone();
    let output_limit = request.max_output_tokens;
    let parallel = request.parallel_tool_calls;
    let effort = request.reasoning_effort.clone();
    let prepared = context
        .prepare(turn_id, request, model_needs_follow_up)
        .await?;
    // Context replacement cannot silently change the frozen model, capabilities,
    // output policy or authorization through tool definitions.
    let same_tools = prepared.request.tools == tools;
    if prepared.request.model != binding
        || !same_tools
        || prepared.request.max_output_tokens != output_limit
        || prepared.request.parallel_tool_calls != parallel
        || prepared.request.reasoning_effort != effort
    {
        return Err(ModelError::InvalidRequest.into());
    }
    Ok(prepared)
}
