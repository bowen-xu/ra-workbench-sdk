use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::{Value, json};

fn prepared() -> PreparedDuplicateUndoV1 {
    PreparedDuplicateUndoV1 {
        snapshot_sha256: "a".repeat(64),
        classification: Some(PreparedClassificationUndoV1 {
            expected_memberships_json: "[]".into(),
            expected_assignments_json: "[]".into(),
            delete_assignments: vec![CollectionAssignment {
                item_id: " raw\0paper ".into(),
                relation_id: "relation".into(),
            }],
            delete_memberships: vec![],
            nal: Some(PreparedNalUndoV1 {
                expected_statements_json: "[]".into(),
                expected_annotations_json: "[]".into(),
                delete_statement_ids: vec!["s".into(), "s".into()],
                delete_annotation_ids: vec!["a".into()],
            }),
        }),
    }
}

#[test]
fn closed_undo_call_and_boxed_preparation_keep_exact_wire_fields_and_operation() {
    assert_eq!(CAPABILITY_ID, "literature.duplicate-undo");
    assert_eq!(CAPABILITY_VERSION, 1);
    let input = CatalogInput::PrepareDuplicateUndo {
        input: UndoMergePrepareInputV1 {
            snapshot_json: " {\"raw\":\"\\u0000\"} \n".into(),
        },
    };
    assert_eq!(input.operation(), CatalogOperation::PrepareDuplicateUndo);
    let encoded = serde_json::to_value(&input).unwrap();
    assert_eq!(
        encoded,
        json!({"kind":"prepareDuplicateUndo","input":{"snapshotJson":" {\"raw\":\"\\u0000\"} \n"}})
    );
    assert_eq!(
        serde_json::from_value::<CatalogInput>(encoded).unwrap(),
        input
    );
    let output = CatalogOutput::DuplicateUndoPreparation {
        outcome: Box::new(prepared()),
    };
    assert_eq!(output.operation(), input.operation());
    let encoded = serde_json::to_value(&output).unwrap();
    assert_eq!(
        encoded,
        json!({"kind":"duplicateUndoPreparation","outcome":{
            "snapshotSha256":"a".repeat(64),"classification":{
                "expectedMembershipsJson":"[]","expectedAssignmentsJson":"[]",
                "deleteAssignments":[{"itemId":" raw\0paper ","relationId":"relation"}],
                "deleteMemberships":[],"nal":{"expectedStatementsJson":"[]",
                "expectedAnnotationsJson":"[]","deleteStatementIds":["s","s"],"deleteAnnotationIds":["a"]}
            }
        }})
    );
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(encoded).unwrap(),
        output
    );
    for classification in [
        None,
        Some(PreparedClassificationUndoV1 {
            expected_memberships_json: "[]".into(),
            expected_assignments_json: "[]".into(),
            delete_assignments: vec![],
            delete_memberships: vec![],
            nal: None,
        }),
    ] {
        let value = PreparedDuplicateUndoV1 {
            snapshot_sha256: "a".repeat(64),
            classification,
        };
        let encoded = serde_json::to_value(&value).unwrap();
        if value.classification.is_none() {
            assert!(encoded["classification"].is_null());
        } else {
            assert!(encoded["classification"]["nal"].is_null());
        }
        assert_eq!(
            serde_json::from_value::<PreparedDuplicateUndoV1>(encoded).unwrap(),
            value
        );
    }
}

#[test]
fn snapshot_and_expected_arrays_stay_raw_strings_without_an_added_term_wrapper() {
    let raw = format!("{}{}{}", "[".repeat(300), "\"raw\"", "]".repeat(300));
    let value = CatalogInput::PrepareDuplicateUndo {
        input: UndoMergePrepareInputV1 {
            snapshot_json: raw.clone(),
        },
    };
    let encoded = serde_json::to_vec(&value).unwrap();
    assert_eq!(
        serde_json::from_slice::<CatalogInput>(&encoded).unwrap(),
        value
    );
    // The wire codec neither parses the stored document nor validates policy.
    assert!(
        serde_json::from_str::<UndoMergePrepareInputV1>(r#"{"snapshotJson":"not-json"}"#).is_ok()
    );
    let json: Value = serde_json::from_slice(&encoded).unwrap();
    assert_eq!(json["input"]["snapshotJson"], raw);
}

#[test]
fn new_undo_wire_containers_reject_unknown_authority_and_non_string_json_fields() {
    for value in [
        json!({"kind":"prepareDuplicateUndo","input":{"snapshotJson":"{}","sql":"PRIVATE"}}),
        json!({"kind":"prepareDuplicateUndo","input":{"snapshotJson":{}}}),
        json!({"kind":"prepareDuplicateUndo","input":{"snapshotJson":"{}"},"transaction":{}}),
    ] {
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
    }
    for pointer in [
        "/outcome",
        "/outcome/classification",
        "/outcome/classification/nal",
    ] {
        let mut value = serde_json::to_value(CatalogOutput::DuplicateUndoPreparation {
            outcome: Box::new(prepared()),
        })
        .unwrap();
        value.pointer_mut(pointer).unwrap()["execute"] = json!("PRIVATE");
        assert!(serde_json::from_value::<CatalogOutput>(value).is_err());
    }
    for pointer in [
        "/outcome/classification/expectedMembershipsJson",
        "/outcome/classification/expectedAssignmentsJson",
        "/outcome/classification/nal/expectedStatementsJson",
        "/outcome/classification/nal/expectedAnnotationsJson",
    ] {
        let mut value = serde_json::to_value(CatalogOutput::DuplicateUndoPreparation {
            outcome: Box::new(prepared()),
        })
        .unwrap();
        *value.pointer_mut(pointer).unwrap() = json!([]);
        assert!(serde_json::from_value::<CatalogOutput>(value).is_err());
    }
}
