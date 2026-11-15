use super::*;
use crate::paper_context_wire::{decode_payload, encode_payload};
use serde_json::json;

#[test]
fn typed_metadata_payload_preserves_original_values_and_pair_order() {
    let input = ContextMetadataInputV1 {
        paper_id: " paper Ω ".into(),
        base: json!({
            "title": " 证据\n🧪\0 ", "abstract": null, "volume": "",
            "numbers": [i64::MIN, i64::MAX, u64::MAX, -0.0, 0.09090909090909091]
        }),
        creators: vec![
            ["  机构".into(), "author".into()],
            ["姓 名 ".into(), "editor".into()],
        ],
        identifiers: vec![["doi".into(), "same".into()], ["doi".into(), "same".into()]],
    };
    let restored: ContextMetadataInputV1 =
        decode_payload(&encode_payload(&input).unwrap()).unwrap();
    assert_eq!(restored, input);
    assert_eq!(restored.base.to_string(), input.base.to_string());
    assert_eq!(
        restored.base["numbers"][3].as_f64().unwrap().to_bits(),
        (-0.0_f64).to_bits()
    );
}

#[test]
fn request_and_result_keep_compact_body_bytes_and_complete_input_echo() {
    let input = ContextMetadataRequestV1 {
        cbor_base64: "ZXhhY3Q=".into(),
    };
    let outcome = ContextMetadataOutcomeV1 {
        input: Box::new(input.clone()),
        decision: ContextMetadataDecisionV1::Projected {
            body_json: "{\"creators\":[],\"identifiers\":[],\"title\":\" α \",\"year\":null}"
                .into(),
        },
    };
    let encoded = serde_json::to_value(&outcome).unwrap();
    assert_eq!(encoded["input"], json!({"cborBase64": "ZXhhY3Q="}));
    assert_eq!(encoded["decision"]["status"], "projected");
    assert_eq!(
        serde_json::from_value::<ContextMetadataOutcomeV1>(encoded).unwrap(),
        outcome
    );
    assert_eq!(outcome.input.as_ref(), &input);
}

#[test]
fn named_catalog_variants_preserve_their_operation_and_reject_extra_fields() {
    use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
    let input = CatalogInput::ProjectContextMetadata {
        input: Box::new(ContextMetadataRequestV1 {
            cbor_base64: "ZXhhY3Q=".into(),
        }),
    };
    assert_eq!(input.operation(), CatalogOperation::ProjectContextMetadata);
    let wire = serde_json::to_value(&input).unwrap();
    assert_eq!(
        wire,
        json!({"kind":"projectContextMetadata","input":{"cborBase64":"ZXhhY3Q="}})
    );
    assert_eq!(
        serde_json::from_value::<CatalogInput>(wire.clone()).unwrap(),
        input
    );
    let outcome = ContextMetadataOutcomeV1 {
        input: Box::new(ContextMetadataRequestV1 {
            cbor_base64: "ZXhhY3Q=".into(),
        }),
        decision: ContextMetadataDecisionV1::Rejected {
            reason: ContextMetadataRejectionV1::InvalidBase,
        },
    };
    let output = CatalogOutput::ContextMetadata {
        outcome: Box::new(outcome),
    };
    assert_eq!(output.operation(), CatalogOperation::ProjectContextMetadata);
    let encoded = serde_json::to_value(&output).unwrap();
    assert_eq!(encoded["kind"], "contextMetadata");
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(encoded.clone()).unwrap(),
        output
    );
    for field in ["sql", "database", "transaction", "path"] {
        let mut request = wire.clone();
        request[field] = json!("private");
        assert!(serde_json::from_value::<CatalogInput>(request).is_err());
        let mut result = encoded.clone();
        result[field] = json!("private");
        assert!(serde_json::from_value::<CatalogOutput>(result).is_err());
    }
}

#[test]
fn envelopes_reject_extra_authority_and_unknown_status_or_rejection() {
    for value in [
        json!({"cborBase64": "AA==", "database": "private"}),
        json!({"candidateJson": "{}"}),
        json!({}),
    ] {
        assert!(serde_json::from_value::<ContextMetadataRequestV1>(value).is_err());
    }
    for value in [
        json!({"status":"projected","bodyJson":"{}","sql":"private"}),
        json!({"status":"rejected","reason":"unknown"}),
        json!({"status":"unavailable"}),
    ] {
        assert!(serde_json::from_value::<ContextMetadataDecisionV1>(value).is_err());
    }
    let input = json!({"paperId":"paper","base":{},"creators":[],"identifiers":[]});
    for field in ["database", "sourcePath", "model", "conversation"] {
        let mut candidate = input.clone();
        candidate[field] = json!("private");
        assert!(serde_json::from_value::<ContextMetadataInputV1>(candidate).is_err());
    }
    assert!(
        serde_json::from_value::<ContextMetadataOutcomeV1>(json!({
            "input":{"cborBase64":"AA=="},
            "decision":{"status":"rejected","reason":"invalidBase"},
            "handle":"private"
        }))
        .is_err()
    );
    for pairs in [
        json!([["one"]]),
        json!([["one", "two", "three"]]),
        json!([[null, "role"]]),
    ] {
        let mut candidate = input.clone();
        candidate["creators"] = pairs;
        assert!(serde_json::from_value::<ContextMetadataInputV1>(candidate).is_err());
    }
}
