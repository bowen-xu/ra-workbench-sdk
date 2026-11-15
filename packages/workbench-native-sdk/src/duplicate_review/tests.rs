use super::*;
use crate::{
    catalog::{CatalogInput, CatalogOperation, CatalogOutput},
    data::DataRows,
};
use serde_json::json;

fn candidate(bits: u64) -> DuplicateCandidateBitsV1 {
    DuplicateCandidateBitsV1 {
        id: " raw\0候选 ".into(),
        left_item_id: "left".into(),
        left_title: " Left ".into(),
        right_item_id: "right".into(),
        right_title: "右侧".into(),
        reason: " raw reason ".into(),
        confidence_bits: F64BitsV1::from_f64(f64::from_bits(bits)),
    }
}

fn request() -> DuplicateDecisionRequestV1 {
    DuplicateDecisionRequestV1 {
        candidate_id: " raw id ".into(),
        decision: "dismiss".into(),
    }
}

#[test]
fn private_bits_preserve_every_ieee_class_without_decimal_roundtrip() {
    for bits in [
        0,
        0x8000_0000_0000_0000,
        0x3fe7_0a3d_70a3_d70a,
        0x3ff0_0000_0000_0000,
        1,
        0x7ff0_0000_0000_0000,
        0xfff0_0000_0000_0000,
        0x7ff8_0000_0000_0001,
    ] {
        let value = candidate(bits);
        let json = serde_json::to_vec(&value).unwrap();
        let decoded: DuplicateCandidateBitsV1 = serde_json::from_slice(&json).unwrap();
        assert_eq!(decoded, value);
        assert_eq!(decoded.clone().into_public().confidence.to_bits(), bits);
        assert_eq!(decoded.confidence_bits.as_str(), format!("{bits:016x}"));
        assert_eq!(decoded.to_row()[6], DataValue::Text(format!("{bits:016x}")));
    }
    assert_eq!(F64BitsV1::from_f64(0.72).as_str(), "3fe70a3d70a3d70a");
    // The global data ABI keeps its pre-existing non-finite rejection.
    assert!(DataValue::Real(f64::INFINITY).validate().is_err());
}

#[test]
fn bits_codec_rejects_numeric_uppercase_short_and_extra_representations() {
    for value in [
        json!(1),
        json!(null),
        json!("0"),
        json!("00000000000000000"),
        json!("3FE70A3D70A3D70A"),
        json!("private-bits-xxx"),
        json!({"bits":"0000000000000000"}),
    ] {
        let error = serde_json::from_value::<F64BitsV1>(value).unwrap_err();
        assert!(!error.to_string().contains("private-bits"));
    }
}

#[test]
fn public_candidate_keeps_original_fields_number_order_and_nonfinite_null() {
    let mut value = candidate(0.72_f64.to_bits()).into_public();
    value.id = "candidate".into();
    assert_eq!(
        serde_json::to_string(&value).unwrap(),
        "{\"id\":\"candidate\",\"leftItemId\":\"left\",\"leftTitle\":\" Left \",\"rightItemId\":\"right\",\"rightTitle\":\"右侧\",\"reason\":\" raw reason \",\"confidence\":0.72}"
    );
    value.confidence = f64::INFINITY;
    assert!(
        serde_json::to_string(&value)
            .unwrap()
            .ends_with("\"confidence\":null}")
    );
}

#[test]
fn original_merge_history_shape_and_mechanical_row_encoding_keep_raw_fields() {
    let value = MergeOperation {
        id: "operation".into(),
        survivor_item_id: "survivor".into(),
        survivor_title: " Raw ".into(),
        merged_item_id: "merged".into(),
        merged_title: "原始".into(),
        state: "applied".into(),
        created_at: " raw time ".into(),
    };
    assert_eq!(
        serde_json::to_string(&value).unwrap(),
        "{\"id\":\"operation\",\"survivorItemId\":\"survivor\",\"survivorTitle\":\" Raw \",\"mergedItemId\":\"merged\",\"mergedTitle\":\"原始\",\"state\":\"applied\",\"createdAt\":\" raw time \"}"
    );
    assert_eq!(
        value.to_row(),
        [
            "operation",
            "survivor",
            " Raw ",
            "merged",
            "原始",
            "applied",
            " raw time "
        ]
        .map(|text| DataValue::Text(text.into()))
    );
}

#[test]
fn four_closed_catalog_calls_round_trip_and_keep_their_exact_operation() {
    let rows = DataRows {
        rows: vec![candidate(0.72_f64.to_bits()).to_row()],
    };
    for (input, output, operation) in [
        (
            CatalogInput::ProjectDuplicateCandidates { rows: rows.clone() },
            CatalogOutput::DuplicateCandidates {
                items: vec![candidate(0.72_f64.to_bits())],
            },
            CatalogOperation::ProjectDuplicateCandidates,
        ),
        (
            CatalogInput::ProjectMergeOperations {
                rows: DataRows { rows: vec![] },
            },
            CatalogOutput::MergeOperations { items: vec![] },
            CatalogOperation::ProjectMergeOperations,
        ),
        (
            CatalogInput::PrepareDuplicateDecision { request: request() },
            CatalogOutput::DuplicateDecisionPreparation {
                outcome: DuplicateDecisionPreparationV1::Ready { request: request() },
            },
            CatalogOperation::PrepareDuplicateDecision,
        ),
        (
            CatalogInput::FinishDuplicateDecision {
                input: FinishDuplicateDecisionInputV1 {
                    request: request(),
                    affected_rows: u64::MAX,
                },
            },
            CatalogOutput::DuplicateDecisionCompletion {
                outcome: DuplicateDecisionCompletionV1::Applied {},
            },
            CatalogOperation::FinishDuplicateDecision,
        ),
    ] {
        assert_eq!(input.operation(), operation);
        assert_eq!(output.operation(), operation);
        assert_eq!(
            serde_json::from_slice::<CatalogInput>(&serde_json::to_vec(&input).unwrap()).unwrap(),
            input
        );
        assert_eq!(
            serde_json::from_slice::<CatalogOutput>(&serde_json::to_vec(&output).unwrap()).unwrap(),
            output
        );
    }
}

#[test]
fn sdk_describes_raw_requests_and_never_validates_duplicate_policy() {
    let raw = json!({"kind":"prepareDuplicateDecision","request":{"candidateId":" raw ","decision":" DISMISS "}});
    let parsed: CatalogInput = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), raw);
    let rejected = DuplicateRejectionV1 {
        code: DuplicateRejectionCodeV1::InvalidInput,
        message: "不支持的文献类型： DISMISS ".into(),
    };
    assert_eq!(
        serde_json::to_value(&rejected).unwrap(),
        json!({"code":"invalid_input","message":"不支持的文献类型： DISMISS "})
    );
    assert_eq!(rejected.code.as_str(), "invalid_input");
    assert_eq!(DuplicateRejectionCodeV1::NotFound.as_str(), "not_found");
}

#[test]
fn new_call_shapes_reject_extra_authority_wrong_types_and_applied_payloads() {
    for value in [
        json!({"kind":"prepareDuplicateDecision","request":{"candidateId":"id","decision":"dismiss","sql":"PRIVATE_SQL"}}),
        json!({"kind":"prepareDuplicateDecision","request":{"candidateId":7,"decision":"dismiss"}}),
        json!({"kind":"finishDuplicateDecision","input":{"request":{"candidateId":"id","decision":"dismiss"},"affectedRows":-1}}),
        json!({"kind":"finishDuplicateDecision","input":{"request":{"candidateId":"id","decision":"dismiss"},"affectedRows":0,"transaction":{}}}),
        json!({"kind":"projectMergeOperations","rows":{"rows":[]},"store":{}}),
    ] {
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
    }
    assert!(serde_json::from_value::<CatalogOutput>(json!({"kind":"duplicateDecisionCompletion","outcome":{"kind":"applied","sql":"PRIVATE_SQL"}})).is_err());
    assert!(serde_json::from_value::<DuplicateCandidateBitsV1>(json!({
        "id":"id","leftItemId":"a","leftTitle":"a","rightItemId":"b","rightTitle":"b","reason":"doi","confidence":0.72
    })).is_err());
}
