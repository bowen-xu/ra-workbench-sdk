use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};

#[test]
fn one_catalog_operation_preserves_raw_nested_draft_and_exact_ready_shape() {
    let draft = draft();
    let input = CatalogInput::PrepareReferenceRecord {
        input: Box::new(ReferenceRecordPrepareInputV1 {
            draft: draft.clone(),
        }),
    };
    let mut expected = json!({"kind":"prepareReferenceRecord","input":{"draft":draft}});
    assert_eq!(input.operation(), CatalogOperation::PrepareReferenceRecord);
    assert_eq!(serde_json::to_value(&input).unwrap(), expected);
    expected["input"]["draft"]["futureField"] = json!(true);
    let decoded: CatalogInput = serde_json::from_value(expected).unwrap();
    assert_eq!(decoded, input);
    let output = CatalogOutput::ReferenceRecordPreparation {
        outcome: Box::new(ReferenceRecordPreparationV1::Ready {
            plan: Box::new(ReferenceRecordPlanV1 {
                draft: draft.clone(),
                raw_text: "引用".into(),
                usage_summary: String::new(),
                change_reason: "reason".into(),
                fields_json: serde_json::to_string(&draft.fields).unwrap(),
                snapshot_json: serde_json::to_string(&draft).unwrap(),
            }),
        }),
    };
    assert_eq!(output.operation(), CatalogOperation::PrepareReferenceRecord);
    let value = serde_json::to_value(&output).unwrap();
    assert_eq!(value["kind"], "referenceRecordPreparation");
    assert_eq!(value["outcome"]["status"], "ready");
    assert_eq!(
        value["outcome"]["plan"]["draft"],
        serde_json::to_value(draft).unwrap()
    );
    assert_eq!(value["outcome"]["plan"].as_object().unwrap().len(), 6);
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(value).unwrap(),
        output
    );
}

#[test]
fn new_envelopes_reject_extra_authority_and_unknown_or_malformed_outcomes() {
    let original = json!({"kind":"prepareReferenceRecord","input":{"draft":draft()}});
    for (index, mutate) in [
        |v: &mut Value| v["sql"] = json!("private"),
        |v: &mut Value| v["input"]["steps"] = json!([]),
        |v: &mut Value| v["input"]["transaction"] = json!("private"),
        |v: &mut Value| v["input"]["draft"]["expectedRevision"] = json!(1.5),
    ]
    .into_iter()
    .enumerate()
    {
        let mut value = original.clone();
        mutate(&mut value);
        assert!(
            serde_json::from_value::<CatalogInput>(value).is_err(),
            "input mutation {index}"
        );
    }
    let original = json!({"kind":"referenceRecordPreparation","outcome":{
        "status":"rejected","reason":"invalidFields"
    }});
    let decoded: CatalogOutput = serde_json::from_value(original.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), original);
    for (index, mutate) in [
        |v: &mut Value| v["outcome"]["sql"] = json!("private"),
        |v: &mut Value| v["outcome"]["reason"] = json!("unknown"),
        |v: &mut Value| v["outcome"]["reason"] = json!({"invalidFields":{}}),
        |v: &mut Value| v["outcome"]["status"] = json!("execute"),
    ]
    .into_iter()
    .enumerate()
    {
        let mut value = original.clone();
        mutate(&mut value);
        assert!(
            serde_json::from_value::<CatalogOutput>(value).is_err(),
            "output mutation {index}"
        );
    }
    let invalid = json!({"status":"ready","plan":{
        "draft":draft(),"rawText":"raw","usageSummary":"","changeReason":"reason",
        "fieldsJson":"[]","snapshotJson":"{}","steps":[]
    }});
    assert!(serde_json::from_value::<ReferenceRecordPreparationV1>(invalid).is_err());
}
