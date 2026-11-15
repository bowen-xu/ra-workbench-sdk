use super::*;

fn parse(event: StopEvent, code: Option<i32>, stdout: &str, stderr: &str) -> StopHandlerOutput {
    StopHandlerOutput::from_process_output(event, code, stdout, stderr)
}

#[test]
fn stop_and_subagent_stop_decode_block_reason_and_universal_fields() {
    for event in [StopEvent::Stop, StopEvent::SubagentStop] {
        let output = parse(
            event,
            Some(0),
            r#"{"decision":"block","reason":"  retry with tests \n", "systemMessage":"notice", "suppressOutput":true}"#,
            "ignored",
        );
        assert_eq!(
            output.status,
            StopHandlerStatus::Blocked {
                feedback: "retry with tests".into()
            }
        );
        assert_eq!(output.system_message.as_deref(), Some("notice"));
        assert_eq!(
            parse(event, Some(0), "  ", "ignored").status,
            StopHandlerStatus::Completed
        );
        assert_eq!(
            parse(event, Some(0), "{}", "ignored").status,
            StopHandlerStatus::Completed
        );
    }
}

#[test]
fn stop_overrides_block_and_retains_reason_even_when_block_reason_is_blank() {
    let output = parse(
        StopEvent::Stop,
        Some(0),
        r#"{"continue":false,"stopReason":"done","decision":"block","reason":" "}"#,
        "",
    );
    assert_eq!(
        output.status,
        StopHandlerStatus::Stopped {
            reason: Some("done".into())
        }
    );
}

#[test]
fn invalid_output_and_empty_feedback_fail_without_continuation() {
    for event in [StopEvent::Stop, StopEvent::SubagentStop] {
        for stdout in [
            "not json",
            "[]",
            r#"{"decision":"allow"}"#,
            r#"{"decision":"block"}"#,
            r#"{"decision":"block","reason":"  "}"#,
            r#"{"continue":null}"#,
            r#"{"unknown":true}"#,
        ] {
            assert!(
                matches!(
                    parse(event, Some(0), stdout, "").status,
                    StopHandlerStatus::Failed { .. }
                ),
                "{event:?}: {stdout}"
            );
        }
        assert!(matches!(
            parse(event, Some(2), "ignored", " \n").status,
            StopHandlerStatus::Failed { .. }
        ));
        assert!(matches!(
            parse(
                event,
                Some(1),
                r#"{"decision":"block","reason":"ignore"}"#,
                "ignored"
            )
            .status,
            StopHandlerStatus::Failed { .. }
        ));
        assert!(matches!(
            parse(event, None, "", "").status,
            StopHandlerStatus::Failed { .. }
        ));
    }
}

#[test]
fn exit_two_uses_only_trimmed_stderr_as_feedback() {
    let output = parse(
        StopEvent::Stop,
        Some(2),
        r#"{"continue":false}"#,
        "  retry now \n",
    );
    assert_eq!(
        output.status,
        StopHandlerStatus::Blocked {
            feedback: "retry now".into()
        }
    );
}

#[test]
fn aggregate_preserves_declaration_order_and_stop_overrides_all_blocks() {
    let first = parse(
        StopEvent::Stop,
        Some(0),
        r#"{"decision":"block","reason":"first"}"#,
        "",
    );
    let second = parse(StopEvent::Stop, Some(2), "", "second");
    let failed = parse(StopEvent::Stop, Some(3), "", "");
    let aggregate =
        aggregate_stop_outputs([("run-1", &first), ("run-2", &failed), ("run-3", &second)]);
    assert_eq!(
        aggregate.fragments,
        vec![
            StopPromptFragment {
                hook_run_id: "run-1".into(),
                text: "first".into()
            },
            StopPromptFragment {
                hook_run_id: "run-3".into(),
                text: "second".into()
            }
        ]
    );
    assert!(!aggregate.stopped);
    let stopped = parse(
        StopEvent::Stop,
        Some(0),
        r#"{"continue":false,"stopReason":"done"}"#,
        "",
    );
    let aggregate =
        aggregate_stop_outputs([("run-1", &first), ("run-2", &stopped), ("run-3", &second)]);
    assert!(aggregate.stopped);
    assert_eq!(aggregate.stop_reason.as_deref(), Some("done"));
    assert!(aggregate.fragments.is_empty());
}
