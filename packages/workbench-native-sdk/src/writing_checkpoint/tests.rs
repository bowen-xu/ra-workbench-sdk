use super::*;
use serde_json::json;

#[test]
fn checkpoint_boxes_preserve_original_records_and_require_explicit_nullable_reads() {
    let checkpoint = DocumentCheckpoint {
        schema_version: 1,
        manuscript_id: "synthetic".into(),
        relative_path: "main.tex".into(),
        version: 3,
        content: "current text".into(),
        review_baseline: "review baseline".into(),
        saved_sha256: "a".repeat(64),
        saved_version: 2,
        operations: vec![],
        save_intent: None,
        editor_receipt: None,
    };
    let record = CheckpointRecord {
        revision: 1,
        checkpoint: checkpoint.clone(),
    };
    let input = CheckpointInput::Save {
        write: Box::new(CheckpointWrite {
            expected_revision: Some(1),
            checkpoint,
        }),
        current: Some(Box::new(record.clone())),
    };
    let mut value = serde_json::to_value(&input).unwrap();
    assert_eq!(value["current"], serde_json::to_value(&record).unwrap());
    assert_eq!(
        serde_json::from_value::<CheckpointInput>(value.clone()).unwrap(),
        input
    );
    assert!(
        !value["current"]["checkpoint"]
            .as_object()
            .unwrap()
            .contains_key("editorReceipt")
    );
    value.as_object_mut().unwrap().remove("current");
    assert!(serde_json::from_value::<CheckpointInput>(value.clone()).is_err());
    value["current"] = json!(null);
    assert!(serde_json::from_value::<CheckpointInput>(value.clone()).is_ok());
    value["sql"] = json!("select synthetic");
    assert!(serde_json::from_value::<CheckpointInput>(value).is_err());
    let output = CheckpointDecision::Read {
        record: Some(Box::new(record.clone())),
    };
    assert_eq!(
        serde_json::to_value(&output).unwrap(),
        json!({"phase":"read","record":record})
    );
    assert_eq!(
        serde_json::from_value::<CheckpointDecision>(serde_json::to_value(&output).unwrap())
            .unwrap(),
        output
    );
    assert!(serde_json::from_value::<CheckpointDecision>(json!({"phase":"read"})).is_err());
    assert_eq!(
        serde_json::to_value(CheckpointDecision::Read { record: None }).unwrap(),
        json!({"phase":"read","record":null})
    );
}
