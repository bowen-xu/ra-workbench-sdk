use super::*;
use serde_json::json;

#[test]
fn original_request_retains_optional_fields_nil_ids_and_uuid_spelling() {
    let raw = json!({
        "manuscriptId":"00000000000000000000000000000000",
        "files":[{"relativePath":"main.tex","expectedDiskSha256":"A".repeat(64)}]
    });
    let request: WritingContextRequest = serde_json::from_value(raw.clone()).unwrap();
    assert!(request.manuscript_id.is_nil());
    assert!(request.files[0].buffer.is_none());
    assert!(request.files[0].selection.is_none());
    let mut unknown = raw;
    unknown["files"][0]["directory"] = json!("synthetic");
    assert!(serde_json::from_value::<WritingContextRequest>(unknown).is_err());
    let mut serialized = serde_json::to_value(&request).unwrap();
    assert_eq!(serialized["files"][0]["buffer"], json!(null));
    serialized["files"][0]["buffer"] = json!({"revision":Uuid::nil(),"text":"草稿"});
    assert!(serde_json::from_value::<WritingContextRequest>(serialized).is_ok());
}

#[test]
fn context_stage_uses_closed_project_protocol_and_original_error_identity() {
    use crate::writing_project::{Decision, Input, Operation, Output};
    let input = Input::Context {
        input: Box::new(ContextInput::Validate {
            request: WritingContextRequest {
                manuscript_id: Uuid::nil(),
                files: vec![],
            },
        }),
    };
    assert_eq!(input.operation(), Operation::Context);
    let output = Output {
        input,
        decision: Decision::Context {
            decision: Box::new(ContextDecision::Rejected {
                reason: WritingContextError::InvalidInput,
            }),
        },
    };
    let raw = serde_json::to_value(&output).unwrap();
    assert_eq!(raw["input"]["kind"], "context");
    assert_eq!(raw["decision"]["decision"]["reason"], "invalidInput");
    assert_eq!(serde_json::from_value::<Output>(raw).unwrap(), output);
    assert_eq!(
        WritingContextError::Conflict.to_string(),
        "writing context changed; refresh its snapshot"
    );
    assert!(
        serde_json::from_value::<ContextInput>(
            json!({"phase":"materialize","manuscriptId":Uuid::nil()})
        )
        .is_err()
    );
    assert!(serde_json::from_value::<ContextInput>(json!({"phase":"validate","request":{"manuscriptId":Uuid::nil(),"files":[]},"sql":"select 1"})).is_err());
}
