//! One model stream and its owned in-flight tools. Codex drains tools before
//! returning a failed sample, so a retry never races an earlier side effect.
use super::*;
use tools::{QueueStep, ToolQueue};

pub(super) struct SampleError {
    pub error: RunError,
    pub model_failed: bool,
}

pub(super) struct TurnUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

impl TurnUsage {
    pub(super) fn new() -> Self {
        Self {
            input_tokens: Some(0),
            output_tokens: Some(0),
        }
    }
}

impl TurnRunner<'_> {
    #[expect(
        clippy::too_many_arguments,
        reason = "one attempt shares turn budgets and durable history"
    )]
    pub(super) async fn sample(
        &self,
        turn_id: Uuid,
        request: &mut ModelRequest,
        used_calls: &mut HashSet<String>,
        tool_count: &mut usize,
        output_bytes: &mut usize,
        failed_attempts: &mut u8,
        usage: &mut TurnUsage,
        can_follow_up: bool,
        context: Option<&dyn SamplingContext>,
    ) -> Result<ModelResponse, SampleError> {
        let mut assembler = ResponseAssembler::new(self.limits.response)
            .map_err(sample_error)?
            .with_requested_model(request.model.clone());
        let mut stream = self
            .transport
            .start(request.clone())
            .await
            .map_err(|error| SampleError {
                error: error.into(),
                model_failed: true,
            })?;
        let mut output = output::OutputItems::new();
        let mut queue = ToolQueue::new(self.tools);
        let mut tools_phase = false;
        let start = request.messages.len();
        let mut early_results = false;
        let result = async {
            // Keep the same transport read alive while a completed tool is
            // committed; dropping and restarting it can lose stream progress.
            let mut next = stream.next();
            loop {
                let event = match queue.next(&mut next).await? {
                    QueueStep::Tool(completed) => {
                        let result = self
                            .commit_tool(turn_id, *completed, request, context)
                            .await;
                        if result.as_ref().err().is_some_and(RunError::is_event_sink) {
                            queue.stop_waiting();
                        } else if result.is_err() {
                            queue.abort_waiting();
                        }
                        queue.release_result();
                        result?;
                        early_results = true;
                        continue;
                    }
                    QueueStep::Event(event) => event.ok_or(ModelError::IncompleteStream)?,
                };
                drop(next);
                let completed = matches!(event, ModelStreamEvent::Completed { .. });
                assembler.push(event.clone())?;
                self.observe_identity(turn_id, request.request_id, &event)
                    .await?;
                let text_growth = output.text_growth(&event)?;
                if text_growth > 0 {
                    *failed_attempts = 0;
                    *output_bytes = output_bytes
                        .checked_add(text_growth)
                        .ok_or(RunError::Budget)?;
                    if self
                        .limits
                        .output_bytes
                        .is_some_and(|max| *output_bytes > max)
                    {
                        return Err(RunError::Budget);
                    }
                }
                output.observe(self, turn_id, &event).await?;
                if let Some(item) = assembler.completed_item(&event)? {
                    match &item.normalized {
                        Some(ModelOutputItem::ToolCall(call)) => {
                            let mut prepared = self.prepare_tool(
                                call.clone(),
                                request,
                                used_calls,
                                tool_count,
                                can_follow_up,
                            )?;
                            let accepted_id = self
                                .accept_tool(
                                    turn_id,
                                    request.request_id,
                                    &mut output,
                                    &prepared,
                                    &item,
                                )
                                .await?;
                            append_stream_item(request, item, accepted_id, start);
                            if let Some(context) = context {
                                context.observe_item(turn_id, request).await?;
                            }
                            self.validate_tool(&mut prepared, request);
                            if !tools_phase {
                                self.sink
                                    .emit(EventPayload::PhaseChanged {
                                        turn_id,
                                        phase: TurnPhase::RunningTools,
                                    })
                                    .await?;
                                tools_phase = true;
                            }
                            self.persist_tool_intent(turn_id, &prepared).await?;
                            queue.admit(prepared);
                        }
                        Some(ModelOutputItem::Message(_))
                        | Some(ModelOutputItem::ReasoningSummary(_))
                        | None => {
                            let accepted_id = output
                                .accept(self, turn_id, request.request_id, &item, None)
                                .await?;
                            append_stream_item(request, item, accepted_id, start);
                            if let Some(context) = context {
                                context.observe_item(turn_id, request).await?;
                            }
                        }
                    }
                }
                if completed {
                    break;
                }
                next = stream.next();
            }
            let response = assembler.finish()?;
            output.complete_legacy(self, turn_id, &response).await?;
            output::append_legacy(request, &response, start);
            self.sink
                .emit(EventPayload::ModelRequestFinished {
                    turn_id,
                    attempt_id: request.request_id,
                    input_tokens: response.usage.input_tokens,
                    output_tokens: response.usage.output_tokens,
                })
                .await?;
            usage.input_tokens = sum_usage(usage.input_tokens, response.usage.input_tokens)?;
            usage.output_tokens = sum_usage(usage.output_tokens, response.usage.output_tokens)?;
            self.sink
                .emit(EventPayload::Usage {
                    turn_id,
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                })
                .await?;
            if let Some(context) = context {
                if early_results {
                    let mut response_request = request.clone();
                    let tail = response_request
                        .messages
                        .drain(start..)
                        .filter(|message| !matches!(message, ModelMessage::ToolResult { .. }))
                        .collect::<Vec<_>>();
                    response_request.messages.extend(tail);
                    context
                        .observe_response(turn_id, &response_request, &response)
                        .await?;
                    // Restore the live view without reporting the last tool
                    // result a second time to observer implementations.
                    context.observe_item(turn_id, request).await?;
                } else {
                    context
                        .observe_response(turn_id, request, &response)
                        .await?;
                }
            }
            Ok(response)
        }
        .await;
        // Release the HTTP owner before awaiting tools or host retry backoff.
        drop(stream);
        // Persistence failure cannot release retained tool receipts; still await
        // every execution owner before propagating the recovery barrier.
        let record_results = !result.as_ref().err().is_some_and(RunError::is_event_sink);
        if matches!(&result, Err(RunError::Model(ModelError::Canceled))) {
            // A transport cancellation can arrive before an executing tool
            // observes it. Do not start queued effects while draining owners.
            queue.abort_waiting();
        }
        self.finish_tools(turn_id, queue, request, context, record_results)
            .await
            .map_err(|error| SampleError {
                error,
                model_failed: false,
            })?;
        result.map_err(sample_error)
    }

    async fn observe_identity(
        &self,
        turn_id: Uuid,
        attempt_id: Uuid,
        event: &ModelStreamEvent,
    ) -> Result<(), RunError> {
        match event {
            ModelStreamEvent::Started {
                response_id,
                actual_model,
            } => {
                self.sink
                    .emit(EventPayload::ModelResponseStarted {
                        turn_id,
                        attempt_id,
                        response_id: response_id.clone(),
                        model: Some(actual_model.clone()),
                    })
                    .await
            }
            ModelStreamEvent::StartedWithoutModel { response_id } => {
                self.sink
                    .emit(EventPayload::ModelResponseStarted {
                        turn_id,
                        attempt_id,
                        response_id: response_id.clone(),
                        model: None,
                    })
                    .await
            }
            ModelStreamEvent::ModelIdentityObserved(model) => {
                self.sink
                    .emit(EventPayload::ModelIdentityObserved {
                        turn_id,
                        attempt_id,
                        model: model.clone(),
                    })
                    .await
            }
            _ => Ok(()),
        }
    }
}

fn append_stream_item(
    request: &mut ModelRequest,
    item: CompletedModelItem,
    id: Uuid,
    start: usize,
) {
    let insertion = request.messages[start..]
        .iter()
        .position(|message| matches!(message, ModelMessage::ToolResult { .. }))
        .map(|index| start + index);
    output::append_item(request, item, id);
    if let Some(index) = insertion {
        let item = request.messages.pop().expect("just appended item");
        request.messages.insert(index, item);
    }
}

fn sample_error(error: impl Into<RunError>) -> SampleError {
    let error = error.into();
    let model_failed = matches!(error, RunError::Model(_));
    SampleError {
        error,
        model_failed,
    }
}
