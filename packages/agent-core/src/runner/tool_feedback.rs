// Adapted from Codex tools/src/function_call_error.rs and core/src/tools/registry.rs
// at e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Copyright 2025 OpenAI. Research authorization rejections remain fatal at validation.
use super::*;

fn output(code: &str, message: &str, retryable: bool) -> ToolOutput {
    ToolOutput {
        content: serde_json::json!({"code":code,"message":message,"retryable":retryable})
            .to_string(),
        is_error: true,
    }
}

pub(super) fn invalid_arguments(message: &str) -> ToolOutput {
    output("invalid_tool_arguments", message, true)
}

pub(super) fn unknown_tool() -> ToolOutput {
    output(
        "unsupported_tool",
        "No handler is registered for the requested tool name.",
        true,
    )
}

pub(super) fn unsupported_namespace() -> ToolOutput {
    output(
        "unsupported_tool",
        "No handler is registered for the requested tool namespace.",
        true,
    )
}

pub(super) fn not_started() -> ToolOutput {
    output(
        "tool_not_started",
        "Tool validation rejected this request before execution.",
        false,
    )
}

pub(super) fn stopped_before_start() -> ToolOutput {
    output(
        "tool_not_started",
        "Preceding tool work stopped; this dependent call was not started.",
        false,
    )
}

pub(super) fn validate(
    tools: &dyn ToolExecutor,
    call: &ToolCall,
) -> Result<Option<ToolOutput>, RunError> {
    match tools.validate(call) {
        Ok(()) => Ok(None),
        Err(RunError::ToolNotFound) => Ok(Some(unknown_tool())),
        Err(RunError::ToolArguments(message)) => {
            // A malformed diagnostic is an adapter error, not model evidence.
            if message.trim().is_empty()
                || message.chars().count() > 1024
                || message.chars().any(char::is_control)
            {
                return Err(RunError::ToolRejected);
            }
            Ok(Some(output("invalid_tool_arguments", &message, true)))
        }
        Err(error) => Err(error),
    }
}

pub(super) struct Execution {
    pub output: ToolOutput,
    pub receipt_required: bool,
    pub canceled: bool,
}

pub(super) async fn execute(
    tools: &dyn ToolExecutor,
    call: ToolCall,
) -> Result<Execution, RunError> {
    let receipt_required = tools.requires_result_receipt(&call);
    let result = match tools.authorize_and_execute(call).await {
        Ok(output) => {
            return Ok(Execution {
                output,
                receipt_required,
                canceled: false,
            });
        }
        Err(RunError::ToolArguments(message)) => {
            if message.trim().is_empty()
                || message.chars().count() > 1024
                || message.chars().any(char::is_control)
            {
                return Err(RunError::ToolRejected);
            }
            output("invalid_tool_arguments", &message, true)
        }
        Err(RunError::ToolRejected) => {
            output("tool_rejected", "工具请求被当前执行策略拒绝。", false)
        }
        Err(RunError::ToolNotFound) => unknown_tool(),
        Err(RunError::ToolUnavailable) => output("tool_unavailable", "工具当前不可用。", true),
        Err(RunError::Model(ModelError::Canceled)) => {
            return Ok(Execution {
                output: output("tool_canceled", "工具调用已取消。", false),
                receipt_required: false,
                canceled: true,
            });
        }
        Err(error) => return Err(error),
    };
    Ok(Execution {
        output: result,
        receipt_required: false,
        canceled: false,
    })
}
