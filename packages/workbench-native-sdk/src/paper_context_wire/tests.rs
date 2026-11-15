use super::*;
use serde_json::json;

#[test]
fn every_envelope_rejects_additional_authority_and_the_unpublished_json_payload() {
    for operation in ["build", "project", "digest", "preview", "prepare"] {
        assert!(
            serde_json::from_value::<PaperContextInputV1>(json!({
                "operation": operation, "cborBase64": "AA==", "database": "connection"
            }))
            .is_err()
        );
        for value in [
            json!({"operation": operation}),
            json!({"operation": operation,"candidateJson":"{}"}),
        ] {
            assert!(serde_json::from_value::<PaperContextInputV1>(value).is_err());
        }
    }
    assert!(
        serde_json::from_value::<PaperContextInputV1>(json!({
            "operation": "executeSql", "cborBase64": "AA=="
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<PaperContextDecisionV1>(json!({
            "status": "unavailable", "sql": "statement"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<PaperContextOutcomeV1>(json!({
            "input": {"operation":"digest","cborBase64":"AA=="},
            "decision": {"status":"digested","contextHash":"hash"}, "handle": "scope"
        }))
        .is_err()
    );
}

#[test]
fn binary_leaves_do_not_spend_catalog_depth_or_change_the_opaque_input_binding() {
    let value = json!({"text": "证据🧪", "nested": [null, 1, -0.0]});
    let cbor_base64 = encode_payload(&value).unwrap();
    let outcome = PaperContextOutcomeV1 {
        input: Box::new(PaperContextInputV1::Build {
            cbor_base64: cbor_base64.clone(),
        }),
        decision: PaperContextDecisionV1::Built {
            prepared_cbor_base64: cbor_base64,
        },
    };
    let encoded = serde_json::to_vec(&outcome).unwrap();
    assert_eq!(
        serde_json::from_slice::<PaperContextOutcomeV1>(&encoded).unwrap(),
        outcome
    );
}
