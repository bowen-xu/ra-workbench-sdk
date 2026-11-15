use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::json;

fn input() -> StructuredValidationInputV1 {
    StructuredValidationInputV1 {
        target: StructuredTargetV1::Overview,
        candidate_json: " {\"kind\":\"paper_overview_unit_v1\",\"raw\":\"原\\u0000字节\"} \n"
            .into(),
        evidence: vec![
            EvidenceQuote {
                citation_key: " raw\0id ".into(),
                quote_exact: " 一\n二 ".into(),
            },
            EvidenceQuote {
                citation_key: " raw\0id ".into(),
                quote_exact: " another quote ".into(),
            },
        ],
    }
}

#[test]
fn catalog_keeps_json_string_and_ordered_duplicate_evidence_exact() {
    let input = input();
    let wire = CatalogInput::ValidateStructured {
        input: Box::new(input.clone()),
    };
    let value = serde_json::to_value(&wire).unwrap();
    assert_eq!(value["kind"], "validateStructured");
    assert_eq!(value["input"]["candidateJson"], input.candidate_json);
    assert_eq!(value["input"]["evidence"][0]["quoteExact"], " 一\n二 ");
    assert_eq!(serde_json::from_value::<CatalogInput>(value).unwrap(), wire);
    assert_eq!(wire.operation(), CatalogOperation::ValidateStructured);
    assert_eq!(StructuredTargetV1::Portrait.resource_kind(), "portrait");
    assert_eq!(
        StructuredTargetV1::Overview.resource_kind(),
        "structuredReading"
    );
}

#[test]
fn wire_refuses_extra_authority_unknown_target_and_inline_candidate_body() {
    let value = serde_json::to_value(input()).unwrap();
    for replacement in [json!("other"), json!(null), json!({"kind":"portrait"})] {
        let mut bad = value.clone();
        bad["target"] = replacement;
        assert!(serde_json::from_value::<StructuredValidationInputV1>(bad).is_err());
    }
    let mut bad = value.clone();
    bad["candidateJson"] = json!({"kind":"paper_portrait_v1"});
    assert!(serde_json::from_value::<StructuredValidationInputV1>(bad).is_err());
    let mut bad = value.clone();
    bad["sql"] = json!("select private");
    assert!(serde_json::from_value::<StructuredValidationInputV1>(bad).is_err());
    let mut bad = value;
    bad["evidence"][0]["paperId"] = json!("another scope");
    assert!(serde_json::from_value::<StructuredValidationInputV1>(bad).is_err());
}

#[test]
fn canonical_result_is_a_string_and_rejection_retains_original_typed_error() {
    let input = input();
    for outcome in [
        StructuredValidationOutcomeV1::Validated {
            input: Box::new(input.clone()),
            canonical_json: "{\"normalized\":true}".into(),
        },
        StructuredValidationOutcomeV1::Rejected {
            input: Box::new(input.clone()),
            error: CandidateValidationError::InvalidInput("原错误".into()),
        },
        StructuredValidationOutcomeV1::Rejected {
            input: Box::new(input.clone()),
            error: CandidateValidationError::Validation {
                path: "$.claims[1].id".into(),
                message: "原路径错误".into(),
            },
        },
    ] {
        let wire = CatalogOutput::StructuredValidation {
            outcome: Box::new(outcome),
        };
        let value = serde_json::to_value(&wire).unwrap();
        assert!(value["outcome"]["input"]["candidateJson"].is_string());
        if value["outcome"]["status"] == "validated" {
            assert!(value["outcome"]["canonicalJson"].is_string());
        }
        assert_eq!(
            serde_json::from_value::<CatalogOutput>(value).unwrap(),
            wire
        );
        assert_eq!(wire.operation(), CatalogOperation::ValidateStructured);
    }
}
