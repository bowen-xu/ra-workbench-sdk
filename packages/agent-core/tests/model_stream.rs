use research_agent_core::{model::*, protocol::ModelIdentity};
use serde_json::json;
use uuid::Uuid;
#[path = "model_stream/canonical_message.rs"]
mod canonical_message;
#[path = "model_stream/canonical_tool.rs"]
mod canonical_tool;
#[path = "model_stream/output_order.rs"]
mod output_order;

fn identity() -> ModelIdentity {
    ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "model".into(),
        revision: Some("1".into()),
    }
}
fn assembler() -> ResponseAssembler {
    let mut response = ResponseAssembler::new(StreamLimits {
        text_bytes: 64,
        argument_bytes: 128,
        tool_calls: 2,
    })
    .unwrap();
    response
        .push(ModelStreamEvent::Started {
            response_id: "r1".into(),
            actual_model: identity(),
        })
        .unwrap();
    response
}
fn call(response: &mut ResponseAssembler, id: &str) {
    response
        .push(ModelStreamEvent::ToolCallStarted {
            call_id: id.into(),
            name: "read".into(),
        })
        .unwrap();
}
fn delta(response: &mut ResponseAssembler, id: &str, text: &str) {
    response
        .push(ModelStreamEvent::ToolArgumentsDelta {
            call_id: id.into(),
            delta: text.into(),
        })
        .unwrap();
}
fn done(response: &mut ResponseAssembler, id: &str) {
    response
        .push(ModelStreamEvent::ToolCallCompleted { call_id: id.into() })
        .unwrap();
}

#[test]
fn interleaved_calls_keep_identity_and_complete_json_in_done_admission_order() {
    let mut response = assembler();
    call(&mut response, "a");
    call(&mut response, "b");
    delta(&mut response, "a", "{\"path\":");
    delta(&mut response, "b", "{\"path\":\"b.tex\"}");
    done(&mut response, "b");
    delta(&mut response, "a", "\"a.tex\"}");
    done(&mut response, "a");
    response
        .push(ModelStreamEvent::Usage(ModelUsage {
            input_tokens: Some(10),
            output_tokens: None,
        }))
        .unwrap();
    response
        .push(ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        })
        .unwrap();
    let result = response.finish().unwrap();
    assert_eq!(
        result
            .tool_calls
            .iter()
            .map(|call| call.call_id.as_str())
            .collect::<Vec<_>>(),
        ["b", "a"]
    );
    assert_eq!(
        result.tool_calls[0].raw_arguments_json,
        "{\"path\":\"b.tex\"}"
    );
    assert_eq!(
        result.tool_calls[1].raw_arguments_json,
        "{\"path\":\"a.tex\"}"
    );
    assert_eq!(result.usage.input_tokens, Some(10));
    assert_eq!(result.actual_model, identity());
}

#[test]
fn eof_never_finishes_a_response_and_done_keeps_unparsed_arguments() {
    let mut response = assembler();
    response
        .push(ModelStreamEvent::TextDelta("partial".into()))
        .unwrap();
    call(&mut response, "a");
    delta(&mut response, "a", "{}");
    done(&mut response, "a");
    assert_eq!(response.partial_text(), "partial");
    assert!(matches!(
        response.finish(),
        Err(ModelError::IncompleteStream)
    ));
    let mut response = assembler();
    call(&mut response, "a");
    delta(&mut response, "a", "{\"path\":");
    assert_eq!(
        response.push(ModelStreamEvent::ToolCallCompleted {
            call_id: "a".into()
        }),
        Ok(())
    );
    assert!(response.finish().is_err());
}

#[test]
fn duplicate_unknown_and_completed_calls_reject_further_stream_data() {
    for event in [
        ModelStreamEvent::ToolCallStarted {
            call_id: "a".into(),
            name: "read".into(),
        },
        ModelStreamEvent::ToolArgumentsDelta {
            call_id: "missing".into(),
            delta: "{}".into(),
        },
        ModelStreamEvent::ToolArgumentsDelta {
            call_id: "a".into(),
            delta: "extra".into(),
        },
    ] {
        let mut response = assembler();
        call(&mut response, "a");
        delta(&mut response, "a", "{}");
        done(&mut response, "a");
        assert_eq!(response.push(event), Err(ModelError::InvalidStream));
        assert!(response.finish().is_err());
    }
}

#[test]
fn truncation_filtering_and_wrong_finish_reasons_do_not_return_calls() {
    let mut partial = assembler();
    call(&mut partial, "partial");
    delta(&mut partial, "partial", "{\"unfinished\":");
    partial
        .push(ModelStreamEvent::Completed {
            reason: FinishReason::Length,
            end_turn: None,
        })
        .unwrap();
    assert!(matches!(partial.finish(), Err(ModelError::Truncated)));
    for (reason, expected) in [
        (FinishReason::Length, ModelError::Truncated),
        (FinishReason::Filtered, ModelError::Filtered),
    ] {
        let mut response = assembler();
        call(&mut response, "a");
        delta(&mut response, "a", "{}");
        done(&mut response, "a");
        response
            .push(ModelStreamEvent::Completed {
                reason,
                end_turn: None,
            })
            .unwrap();
        assert!(matches!(response.finish(), Err(error) if error == expected));
    }
    let mut response = assembler();
    assert_eq!(
        response.push(ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None
        }),
        Err(ModelError::InvalidStream)
    );
}

#[test]
fn budgets_and_usage_regression_are_enforced() {
    let mut response = assembler();
    assert_eq!(
        response.push(ModelStreamEvent::TextDelta("界".repeat(22))),
        Err(ModelError::BudgetExceeded)
    );
    let mut response = assembler();
    call(&mut response, "a");
    assert_eq!(
        response.push(ModelStreamEvent::ToolArgumentsDelta {
            call_id: "a".into(),
            delta: "x".repeat(129)
        }),
        Err(ModelError::BudgetExceeded)
    );
    let mut response = assembler();
    response
        .push(ModelStreamEvent::Usage(ModelUsage {
            input_tokens: Some(10),
            output_tokens: None,
        }))
        .unwrap();
    assert_eq!(
        response.push(ModelStreamEvent::Usage(ModelUsage {
            input_tokens: Some(9),
            output_tokens: None
        })),
        Err(ModelError::InvalidStream)
    );
}

fn request(messages: Vec<ModelMessage>) -> ModelRequest {
    ModelRequest {
        captured_history: None,
        request_id: Uuid::from_u128(1),
        model: identity(),
        messages,
        tools: vec![],
        max_output_tokens: 100,
        parallel_tool_calls: false,
        reasoning_effort: None,
    }
}
fn capabilities() -> ModelCapabilities {
    ModelCapabilities {
        vision: true,
        tools: true,
        parallel_tools: true,
        reasoning_efforts: vec![],
    }
}

#[test]
fn unsupported_images_and_tools_fail_before_any_transport() {
    let request = request(vec![ModelMessage::User {
        content: vec![ContentPart::Image {
            media_type: "image/png".into(),
            bytes: vec![1, 2].into(),
        }],
        source_item_id: None,
    }]);
    assert_eq!(
        request.validate(ModelCapabilities {
            vision: false,
            ..capabilities()
        }),
        Err(ModelError::UnsupportedCapability)
    );
    let mut request = request;
    request.tools = vec![ToolDefinition {
        namespace: None,
        name: "read".into(),
        description: "read".into(),
        parameters: json!({"type":"object"}),
    }];
    assert_eq!(
        request.validate(ModelCapabilities {
            tools: false,
            ..capabilities()
        }),
        Err(ModelError::UnsupportedCapability)
    );
}

#[test]
fn tool_history_requires_matching_results_before_next_assistant_or_user() {
    let assistant = ModelMessage::Assistant {
        phase: None,
        content: vec![],
        tool_calls: vec![ToolCall {
            namespace: None,
            raw_arguments_json: None,
            call_id: "a".into(),
            name: "read".into(),
            arguments: json!({}),
        }],
    };
    let result = ModelMessage::ToolResult {
        call_id: "a".into(),
        content: "paper".into(),
        is_error: false,
    };
    assert_eq!(
        request(vec![assistant.clone(), result.clone()]).validate(capabilities()),
        Ok(())
    );
    assert_eq!(
        request(vec![assistant.clone()]).validate(capabilities()),
        Err(ModelError::InvalidRequest)
    );
    assert_eq!(
        request(vec![result]).validate(capabilities()),
        Err(ModelError::InvalidRequest)
    );
    assert_eq!(
        request(vec![
            assistant,
            ModelMessage::User {
                content: vec![ContentPart::Text("next".into())],
                source_item_id: None
            }
        ])
        .validate(capabilities()),
        Err(ModelError::InvalidRequest)
    );
}

#[test]
fn reasoning_requires_exact_model_capability_without_silent_normalization() {
    let mut input = request(vec![ModelMessage::User {
        content: vec![ContentPart::Text("read".into())],
        source_item_id: None,
    }]);
    assert_eq!(input.validate(capabilities()), Ok(()));
    input.reasoning_effort = Some("medium".into());
    assert_eq!(
        input.validate(capabilities()),
        Err(ModelError::UnsupportedCapability)
    );
    let mut profile = capabilities();
    profile.reasoning_efforts = vec!["medium".into()];
    assert_eq!(input.validate(profile.clone()), Ok(()));
    input.reasoning_effort = Some("high".into());
    assert_eq!(
        input.validate(profile.clone()),
        Err(ModelError::UnsupportedCapability)
    );
    for invalid in ["", " medium", "medium ", "med\0ium"] {
        input.reasoning_effort = Some(invalid.into());
        assert_eq!(
            input.validate(profile.clone()),
            Err(ModelError::InvalidRequest)
        );
    }
}
