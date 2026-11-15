use super::*;
use serde_json::json;

#[test]
fn template_snapshot_keeps_exact_identity_and_required_claim_ids() {
    let value = json!({"templateResourceId":"template","templateResourceRevision":2,
        "fields":[{"id":"question","title":"问题","question":"哪一个问题？","claimIds":[]}]});
    let snapshot: PaperTemplateSnapshot = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(snapshot).unwrap(), value);
    for extra in [
        json!({"portraitCandidateId":"portrait","portraitRevision":1}),
        json!({"extra":true}),
    ] {
        let mut invalid = value.clone();
        invalid
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert!(serde_json::from_value::<PaperTemplateSnapshot>(invalid).is_err());
    }
    let mut missing = value;
    missing["fields"][0]
        .as_object_mut()
        .unwrap()
        .remove("claimIds");
    assert!(serde_json::from_value::<PaperTemplateSnapshot>(missing).is_err());
}

#[test]
fn original_optional_fields_keep_null_and_omission_behavior() {
    let value = json!({"kind":"paper_overview_unit_v1","schemaVersion":1,"profileId":"generic_overview_v1",
        "profileRefs":null,"paperTemplate":null,"fields":[{"field":"question","status":"filled",
        "statements":[{"id":"s","text":"text","epistemicRole":"uncertain","evidenceItemIds":[],"evidenceQuotes":null}]}]});
    let payload: PaperOverviewPayload = serde_json::from_value(value).unwrap();
    let encoded = serde_json::to_value(payload).unwrap();
    assert!(encoded.get("profileRefs").is_none() && encoded.get("paperTemplate").is_none());
    assert!(
        encoded["fields"][0]["statements"][0]
            .get("evidenceQuotes")
            .is_none()
    );
    let portrait: PaperPortraitPayload =
        serde_json::from_value(json!({"kind":"paper_portrait_v1","schemaVersion":1,
        "coverage":"selected excerpts","claims":[],"template":[]}))
        .unwrap();
    assert!(
        serde_json::to_value(portrait)
            .unwrap()
            .get("customDimensions")
            .is_none()
    );
}

#[test]
fn pure_rejection_preserves_original_display_and_closed_wire() {
    for error in [
        CandidateValidationError::InvalidInput("原原因".into()),
        CandidateValidationError::Validation {
            path: "$.kind".into(),
            message: "目标不匹配".into(),
        },
    ] {
        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(
            serde_json::from_value::<CandidateValidationError>(value.clone()).unwrap(),
            error
        );
        let mut invalid = value;
        invalid["body"] = json!("not a diagnostic field");
        assert!(serde_json::from_value::<CandidateValidationError>(invalid).is_err());
    }
    assert_eq!(
        CandidateValidationError::InvalidInput("原原因".into()).to_string(),
        "原原因"
    );
    assert_eq!(
        CandidateValidationError::Validation {
            path: "$.kind".into(),
            message: "目标不匹配".into()
        }
        .to_string(),
        "$.kind: 目标不匹配"
    );
}

#[test]
fn evidence_wire_retains_order_duplicate_keys_and_exact_unicode_quotes() {
    let value = json!([{"citationKey":"E1","quoteExact":"first"},{"citationKey":"E1","quoteExact":"原文🙂\r\n  exact"}]);
    let evidence: Vec<EvidenceQuote> = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(evidence.len(), 2);
    assert_eq!(
        evidence[1].quote_exact.as_bytes(),
        "原文🙂\r\n  exact".as_bytes()
    );
    assert_eq!(serde_json::to_value(evidence).unwrap(), value);
    assert!(
        serde_json::from_value::<EvidenceQuote>(
            json!({"citationKey":"E1","quoteExact":"text","unknown":1})
        )
        .is_err()
    );
}
