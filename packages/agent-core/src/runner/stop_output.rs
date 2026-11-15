//! Stop output semantics adapted from OpenAI Codex hooks/src/events/stop.rs,
//! hooks/src/engine/output_parser.rs and hooks/src/schema.rs, commit
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0, Copyright 2025 OpenAI).
//! Process ownership, output limits, audit and durable prompts remain host-owned.
use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopEvent {
    Stop,
    SubagentStop,
}

impl StopEvent {
    fn name(self) -> &'static str {
        match self {
            Self::Stop => "Stop",
            Self::SubagentStop => "SubagentStop",
        }
    }
    fn json_error(self) -> &'static str {
        match self {
            Self::Stop => "hook returned invalid stop hook JSON output",
            Self::SubagentStop => "hook returned invalid subagent stop hook JSON output",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StopHandlerStatus {
    Completed,
    Failed { diagnostic: String },
    Stopped { reason: Option<String> },
    Blocked { feedback: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StopHandlerOutput {
    pub status: StopHandlerStatus,
    pub system_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Universal {
    #[serde(default = "default_continue")]
    r#continue: bool,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    suppress_output: bool,
    #[serde(default)]
    system_message: Option<String>,
}

fn default_continue() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutputWire {
    #[serde(flatten)]
    universal: Universal,
    #[serde(default)]
    decision: Option<BlockDecision>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Deserialize)]
enum BlockDecision {
    #[serde(rename = "block")]
    Block,
}

impl StopHandlerOutput {
    /// Decode complete, bounded process output after the host applies the
    /// reference's lossy UTF-8 decoding. Transport failures,
    /// truncation and cancellation must be reported by the host before calling.
    pub fn from_process_output(
        event: StopEvent,
        exit_code: Option<i32>,
        stdout: &str,
        stderr: &str,
    ) -> Self {
        let fail = |diagnostic: String| Self {
            status: StopHandlerStatus::Failed { diagnostic },
            system_message: None,
        };
        match exit_code {
            Some(0) if stdout.trim().is_empty() => Self {
                status: StopHandlerStatus::Completed,
                system_message: None,
            },
            Some(0) => {
                let parsed = serde_json::from_str::<serde_json::Value>(stdout.trim())
                    .ok()
                    .filter(serde_json::Value::is_object)
                    .and_then(|value| serde_json::from_value::<OutputWire>(value).ok());
                let Some(parsed) = parsed else {
                    return fail(event.json_error().into());
                };
                let Universal {
                    r#continue,
                    stop_reason,
                    suppress_output,
                    system_message,
                } = parsed.universal;
                let _ = suppress_output;
                let status = if !r#continue {
                    StopHandlerStatus::Stopped {
                        reason: stop_reason,
                    }
                } else if parsed.decision.is_some() {
                    match parsed
                        .reason
                        .as_deref()
                        .map(str::trim)
                        .filter(|reason| !reason.is_empty())
                    {
                        Some(reason) => StopHandlerStatus::Blocked {
                            feedback: reason.to_owned(),
                        },
                        None => StopHandlerStatus::Failed {
                            diagnostic: format!(
                                "{} hook returned decision:block without a non-empty reason",
                                event.name()
                            ),
                        },
                    }
                } else {
                    StopHandlerStatus::Completed
                };
                Self {
                    status,
                    system_message,
                }
            }
            Some(2) => match stderr.trim() {
                "" => fail(format!(
                    "{} hook exited with code 2 but did not write a continuation prompt to stderr",
                    event.name()
                )),
                feedback => Self {
                    status: StopHandlerStatus::Blocked {
                        feedback: feedback.to_owned(),
                    },
                    system_message: None,
                },
            },
            Some(code) => fail(format!("hook exited with code {code}")),
            None => fail("hook exited without a status code".into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StopPromptFragment {
    pub hook_run_id: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StopOutputAggregate {
    pub stopped: bool,
    pub stop_reason: Option<String>,
    pub fragments: Vec<StopPromptFragment>,
}

/// Input is declaration order, not process completion order. Any stop takes
/// precedence over all block feedback; failures do not veto other handlers.
pub fn aggregate_stop_outputs<'a>(
    results: impl IntoIterator<Item = (&'a str, &'a StopHandlerOutput)>,
) -> StopOutputAggregate {
    let results: Vec<_> = results.into_iter().collect();
    let stopped = results
        .iter()
        .any(|(_, output)| matches!(output.status, StopHandlerStatus::Stopped { .. }));
    let stop_reason = results.iter().find_map(|(_, output)| match &output.status {
        StopHandlerStatus::Stopped { reason } => reason.clone(),
        _ => None,
    });
    let fragments = if stopped {
        Vec::new()
    } else {
        results
            .into_iter()
            .filter_map(|(id, output)| match &output.status {
                StopHandlerStatus::Blocked { feedback } => Some(StopPromptFragment {
                    hook_run_id: id.to_owned(),
                    text: feedback.clone(),
                }),
                _ => None,
            })
            .collect()
    };
    StopOutputAggregate {
        stopped,
        stop_reason,
        fragments,
    }
}

#[cfg(test)]
mod tests;
