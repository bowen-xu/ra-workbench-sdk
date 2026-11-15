use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::json;

fn input() -> MergePrepareInputV1 {
    MergePrepareInputV1 {
        candidate_id: " raw\0candidate ".into(),
        survivor_item_id: " left ".into(),
        left_item_id: " left ".into(),
        right_item_id: "\0right ".into(),
    }
}

#[test]
fn merge_preparation_has_exact_closed_fields_and_catalog_operation() {
    assert_eq!(CAPABILITY_ID, "literature.duplicate-merge");
    assert_eq!(CAPABILITY_VERSION, 1);
    let request = input();
    let call = CatalogInput::PrepareDuplicateMerge {
        input: Box::new(request.clone()),
    };
    assert_eq!(call.operation(), CatalogOperation::PrepareDuplicateMerge);
    let encoded = serde_json::to_value(&call).unwrap();
    let raw_input = json!({"candidateId":" raw\0candidate ","survivorItemId":" left ",
        "leftItemId":" left ","rightItemId":"\0right "});
    assert_eq!(
        encoded,
        json!({"kind":"prepareDuplicateMerge","input":raw_input})
    );
    assert_eq!(
        serde_json::from_value::<CatalogInput>(encoded).unwrap(),
        call
    );
    for outcome in [
        MergePreparationV1::Ready {
            input: request,
            merged_item_id: "\0right ".into(),
            operation_state: "applied".into(),
            created_reading_state: false,
        },
        MergePreparationV1::Rejected {
            reason: MergeRejectionV1::NotFound,
        },
    ] {
        let output = CatalogOutput::DuplicateMergePreparation {
            outcome: Box::new(outcome.clone()),
        };
        assert_eq!(output.operation(), call.operation());
        let value = serde_json::to_value(&output).unwrap();
        let expected = match &outcome {
            MergePreparationV1::Ready { .. } => {
                json!({"status":"ready","input":raw_input,"mergedItemId":"\0right ",
                    "operationState":"applied","createdReadingState":false})
            }
            MergePreparationV1::Rejected { .. } => {
                json!({"status":"rejected","reason":"notFound"})
            }
        };
        assert_eq!(
            value,
            json!({"kind":"duplicateMergePreparation","outcome":expected})
        );
        assert_eq!(
            serde_json::from_value::<CatalogOutput>(value).unwrap(),
            output
        );
    }
}

#[test]
fn request_and_outcome_reject_extra_authority_missing_and_wrong_typed_fields() {
    let original = serde_json::to_value(input()).unwrap();
    for field in ["candidateId", "survivorItemId", "leftItemId", "rightItemId"] {
        let mut missing = original.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<MergePrepareInputV1>(missing).is_err());
        for wrong in [json!(null), json!(1), json!(false), json!([]), json!({})] {
            let mut value = original.clone();
            value[field] = wrong;
            assert!(serde_json::from_value::<MergePrepareInputV1>(value).is_err());
        }
    }
    let mut extra = original.clone();
    extra["sql"] = json!("not-authorized");
    assert!(serde_json::from_value::<MergePrepareInputV1>(extra).is_err());
    let ready = json!({"status":"ready","input":original,"mergedItemId":"right",
        "operationState":"applied","createdReadingState":false});
    for field in ["operationState", "createdReadingState"] {
        let mut missing = ready.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<MergePreparationV1>(missing).is_err());
        let mut wrong = ready.clone();
        wrong[field] = json!(null);
        assert!(serde_json::from_value::<MergePreparationV1>(wrong).is_err());
    }
    for value in [
        json!({"status":"ready","input":original,"mergedItemId":"right","transaction":{}}),
        json!({"status":"ready","input":original}),
        json!({"status":"ready","input":original,"mergedItemId":null}),
        json!({"status":"rejected","reason":"notFound","input":original}),
        json!({"status":"rejected","reason":"invalidInput"}),
        json!({"status":"execute","reason":"notFound"}),
    ] {
        assert!(serde_json::from_value::<MergePreparationV1>(value).is_err());
    }
    for value in [
        json!({"kind":"prepareDuplicateMerge","input":original,"execute":true}),
        json!({"kind":"prepareDuplicateMerge","input":{"candidateId":"x"}}),
        json!({"kind":"duplicateMergePreparation","outcome":{"status":"rejected","reason":"notFound"},"execute":true}),
    ] {
        assert!(
            serde_json::from_value::<CatalogInput>(value.clone()).is_err()
                && serde_json::from_value::<CatalogOutput>(value).is_err()
        );
    }
}

#[test]
fn wire_strings_preserve_empty_long_and_untrimmed_original_values() {
    for raw in [String::new(), " x\0🙂 ".into(), "长".repeat(4097)] {
        let value = MergePrepareInputV1 {
            candidate_id: raw.clone(),
            survivor_item_id: raw.clone(),
            left_item_id: raw.clone(),
            right_item_id: raw,
        };
        assert_eq!(
            serde_json::from_slice::<MergePrepareInputV1>(&serde_json::to_vec(&value).unwrap())
                .unwrap(),
            value
        );
    }
}
