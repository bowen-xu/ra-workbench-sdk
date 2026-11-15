//! Adapted from Codex core/src/tools/parallel.rs and session/turn.rs at
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
//! Runtime-neutral owned futures replace Tokio tasks. Every exit drains them.
use super::*;

pub(super) struct PreparedTool {
    intent: ToolCallIntent,
    call: Option<ToolCall>,
    call_id: Uuid,
    feedback: Option<ToolOutput>,
    failure: Option<RunError>,
    index: usize,
    parallel: bool,
}
mod queue;
pub(super) use queue::{CompletedTool, QueueStep, ToolQueue};

impl TurnRunner<'_> {
    pub(super) async fn persist_tool_intent(
        &self,
        turn_id: Uuid,
        prepared: &PreparedTool,
    ) -> Result<(), RunError> {
        if prepared.feedback.is_some() || prepared.failure.is_some() {
            return Ok(());
        }
        let Some(call) = prepared.call.as_ref() else {
            return Ok(());
        };
        let Some(intent) = self.tools.child_creation_intent(call) else {
            return Ok(());
        };
        self.sink
            .emit(EventPayload::ChildCreationPrepared {
                turn_id,
                call_id: prepared.call_id,
                version: 2,
                child_id: *intent.id.as_uuid(),
                operation_id: intent.operation_id,
                binding: intent.binding,
                submission_request_id: Some(crate::conversation::child_submission_request_id(
                    *intent.id.as_uuid(),
                )),
            })
            .await
    }
    pub(super) fn prepare_tool(
        &self,
        call: ToolCallIntent,
        request: &ModelRequest,
        used_calls: &mut HashSet<String>,
        tool_count: &mut usize,
        can_follow_up: bool,
    ) -> Result<PreparedTool, RunError> {
        let index = *tool_count;
        if !can_follow_up {
            return Err(RunError::Budget);
        }
        let count = index.checked_add(1).ok_or(RunError::Budget)?;
        if self.limits.tool_calls.is_some_and(|max| count > max) {
            return Err(RunError::Budget);
        }
        if !used_calls.insert(call.call_id.clone()) {
            return Err(rejected_call(&call, request, "duplicate_call_id", index));
        }
        *tool_count = count;
        Ok(PreparedTool {
            parallel: false,
            intent: call,
            call: None,
            call_id: self.ids.next_id(),
            feedback: None,
            failure: None,
            index,
        })
    }

    /// The caller has durably accepted the original intent. Neither parameter
    /// parsing nor registered validation may erase that fact or acquire a grant
    /// before this boundary.
    pub(super) fn validate_tool(&self, tool: &mut PreparedTool, request: &ModelRequest) {
        let namespace = tool.intent.namespace.as_deref();
        let route = self
            .tools
            .resolve_qualified_name(namespace, &tool.intent.name);
        if route == ToolNameResolution::NotFound
            || (namespace.is_some() && route != ToolNameResolution::Registered)
        {
            tool.feedback = Some(if namespace.is_some() {
                tool_feedback::unsupported_namespace()
            } else {
                tool_feedback::unknown_tool()
            });
            return;
        }
        let call = match tool.intent.parse() {
            Ok(call) => call,
            Err(crate::model::ToolCallParseError::Json(error)) => {
                tool.feedback = Some(tool_feedback::invalid_arguments(&format!(
                    "Arguments must be valid JSON (syntax error at line {}, column {}).",
                    error.line(),
                    error.column()
                )));
                return;
            }
        };
        match tool_feedback::validate(self.tools, &call) {
            Ok(feedback) => tool.feedback = feedback,
            Err(error) => {
                tool.failure = Some(match error {
                    RunError::ToolRejected => rejected_call(
                        &tool.intent,
                        request,
                        "executor_validation_rejected",
                        tool.index,
                    ),
                    other => other,
                });
                tool.feedback = Some(tool_feedback::not_started());
            }
        }
        tool.parallel = tool.feedback.is_none() && self.tools.supports_parallel(&call);
        tool.call = Some(call);
    }
    pub(super) async fn accept_tool(
        &self,
        turn_id: Uuid,
        attempt_id: Uuid,
        output: &mut output::OutputItems,
        tool: &PreparedTool,
        item: &CompletedModelItem,
    ) -> Result<Uuid, RunError> {
        output
            .accept(self, turn_id, attempt_id, item, Some(tool.call_id))
            .await
    }
    pub(super) async fn finish_tools(
        &self,
        turn_id: Uuid,
        mut queue: ToolQueue<'_>,
        request: &mut ModelRequest,
        context: Option<&dyn SamplingContext>,
        record_results: bool,
    ) -> Result<(), RunError> {
        let mut failure = None;
        if !record_results {
            queue.stop_waiting();
        }
        while let Some(completed) = queue.next_result().await {
            if !record_results || failure.as_ref().is_some_and(RunError::is_event_sink) {
                queue.release_result();
                continue;
            }
            let result = self.commit_tool(turn_id, completed, request, context).await;
            // On an uncertain commit/outcome, stop unstarted dependent effects;
            // still join every active owner and preserve other known results.
            if result.as_ref().err().is_some_and(RunError::is_event_sink) {
                queue.stop_waiting();
            } else if result.is_err() {
                queue.abort_waiting();
            }
            if result.as_ref().err().is_some_and(|error| {
                failure
                    .as_ref()
                    .is_none_or(|old| failure_priority(error) > failure_priority(old))
            }) {
                failure = result.err();
            }
            queue.release_result();
        }
        failure.map_or(Ok(()), Err)
    }
    pub(super) async fn commit_tool(
        &self,
        turn_id: Uuid,
        completed: CompletedTool,
        request: &mut ModelRequest,
        context: Option<&dyn SamplingContext>,
    ) -> Result<(), RunError> {
        let execution = completed.result?;
        let prepared = completed.prepared;
        let result = execution.output;
        if result.content.len()
            > self
                .limits
                .tool_output_bytes
                .max(crate::protocol::MAX_NATIVE_ITEM_BYTES)
        {
            return Err(RunError::Budget);
        }
        let item_id = self.ids.next_id();
        if execution.receipt_required {
            self.sink
                .emit(EventPayload::ToolReceiptPending {
                    turn_id,
                    call_id: prepared.call_id,
                })
                .await?;
        }
        self.sink
            .emit(EventPayload::ItemStarted {
                turn_id,
                item_id,
                kind: ItemKind::ToolResult {
                    call_id: prepared.call_id,
                    is_error: Some(result.is_error),
                },
            })
            .await?;
        self.emit_text(turn_id, item_id, &result.content).await?;
        self.sink
            .emit(EventPayload::ItemCompleted { turn_id, item_id })
            .await?;
        if execution.receipt_required {
            self.tools
                .result_committed(prepared.call.ok_or(RunError::EventSink)?)
                .await
                .map_err(|error| match error {
                    RunError::ToolOutcomeUnknownDiagnostic(detail)
                    | RunError::EventSinkDiagnostic(detail) => {
                        RunError::EventSinkDiagnostic(detail)
                    }
                    _ => RunError::EventSink,
                })?;
            self.sink
                .emit(EventPayload::ToolReceiptConfirmed {
                    turn_id,
                    call_id: prepared.call_id,
                })
                .await?;
        }
        // A model-view budget failure must not discard a known tool outcome or
        // leave its owner awaiting a receipt after the full result was saved.
        let view = crate::model::tool_output::project_tool_output(
            &result.content,
            self.transport.tool_output_policy(),
            self.limits.tool_output_bytes,
        )
        .ok_or(RunError::Budget)?;
        request.messages.push(ModelMessage::ToolResult {
            call_id: prepared.intent.call_id,
            content: view,
            is_error: result.is_error,
        });
        if let Some(context) = context {
            context.observe_tool_result(turn_id, request).await?;
        }
        if execution.canceled {
            return Err(ModelError::Canceled.into());
        }
        if let Some(error) = prepared.failure {
            return Err(error);
        }
        Ok(())
    }
    #[expect(
        clippy::too_many_arguments,
        reason = "one finalization joins the existing tool owner"
    )]
    pub(super) async fn finalize(
        &self,
        turn_id: Uuid,
        call: ToolCall,
        request: &mut ModelRequest,
        used_calls: &mut HashSet<String>,
        tool_count: &mut usize,
        can_follow_up: bool,
        context: Option<&dyn SamplingContext>,
    ) -> Result<(), RunError> {
        let intent = ToolCallIntent::try_from(&call)?;
        let mut prepared = self.prepare_tool(
            intent.clone(),
            request,
            used_calls,
            tool_count,
            can_follow_up,
        )?;
        self.sink
            .emit(EventPayload::PhaseChanged {
                turn_id,
                phase: TurnPhase::RunningTools,
            })
            .await?;
        let item_id = self.ids.next_id();
        self.sink
            .emit(EventPayload::ItemAccepted {
                turn_id,
                item_id,
                kind: ItemKind::ToolCall {
                    call_id: prepared.call_id,
                    name: call.name.clone(),
                    provider_call_id: Some(call.call_id.clone()),
                    namespace: None,
                },
                text: intent.raw_arguments_json.clone(),
                phase: None,
                source: None,
            })
            .await?;
        output::append_item(
            request,
            CompletedModelItem {
                canonical_item_id: None,
                normalized: Some(ModelOutputItem::ToolCall(intent)),
                native: None,
            },
            item_id,
        );
        if let Some(context) = context {
            context.observe_item(turn_id, request).await?;
        }
        self.validate_tool(&mut prepared, request);
        self.persist_tool_intent(turn_id, &prepared).await?;
        let mut queue = ToolQueue::new(self.tools);
        queue.admit(prepared);
        self.finish_tools(turn_id, queue, request, context, true)
            .await
    }
}

fn failure_priority(error: &RunError) -> u8 {
    match error {
        RunError::EventSink => 4,
        RunError::Model(ModelError::Persistence | ModelError::PersistenceDiagnostic(_)) => 4,
        RunError::EventSinkDiagnostic(_) => 3,
        RunError::ToolOutcomeUnknownDiagnostic(_) => 2,
        RunError::ToolOutcomeUnknown => 1,
        _ => 0,
    }
}

fn diagnostic_identifier(value: &str) -> &str {
    if !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-.:/".contains(&byte))
    {
        value
    } else {
        "<invalid identifier>"
    }
}
fn rejected_call(
    call: &ToolCallIntent,
    request: &ModelRequest,
    code: &str,
    index: usize,
) -> RunError {
    let mut diagnostic = serde_json::json!({
        "code": code, "stage": "validation", "toolName": diagnostic_identifier(&call.name),
        "providerCallId": diagnostic_identifier(&call.call_id),
        "advertised": request.tools.iter().any(|tool| tool.name == call.name && tool.namespace == call.namespace),
        "batchIndex": index,
    });
    if let Some(namespace) = &call.namespace {
        diagnostic["toolNamespace"] = serde_json::json!(diagnostic_identifier(namespace));
    }
    RunError::ToolRejectionDiagnostic(diagnostic.to_string())
}
#[cfg(test)]
#[path = "tools/diagnostic_tests.rs"]
mod diagnostic_tests;
