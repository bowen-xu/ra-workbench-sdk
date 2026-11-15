use super::*;
use serde_json::{Value, json};

#[test]
fn original_patch_and_decision_serde_keeps_defaults_unknown_fields_and_year_bounds() {
    let patch: LiteratureMetadataPatch = serde_json::from_value(json!({
        "fieldName":"creators","value":[{"familyName":" A ","givenName":" B ","extra":true}],"ignored":1
    })).unwrap();
    let LiteratureMetadataPatch::Creators(creators) = &patch else {
        unreachable!()
    };
    assert_eq!(creators[0].literal_name, "");
    assert_eq!(creators[0].role, "author");
    assert_eq!(creators[0].family_name, " A ");
    assert_eq!(
        serde_json::to_string(&patch).unwrap(),
        r#"{"fieldName":"creators","value":[{"familyName":" A ","givenName":" B ","literalName":"","role":"author"}]}"#
    );
    for value in [json!(null), json!(i32::MIN), json!(i32::MAX)] {
        assert!(
            serde_json::from_value::<LiteratureMetadataPatch>(
                json!({"fieldName":"issuedYear","value":value})
            )
            .is_ok()
        );
    }
    for value in [json!(i64::from(i32::MAX) + 1), json!(1.5), json!("2026")] {
        assert!(
            serde_json::from_value::<LiteratureMetadataPatch>(
                json!({"fieldName":"issuedYear","value":value})
            )
            .is_err()
        );
    }
    let decision: MetadataCandidateFieldDecision = serde_json::from_value(
        json!({"fieldName":" raw\u{0000} ","choice":"current","extra":true}),
    )
    .unwrap();
    assert_eq!(decision.field_name, " raw\0 ");
    assert_eq!(decision.choice, MetadataCandidateChoice::Current);
    assert!(serde_json::from_value::<MetadataCandidateTrust>(json!("Trusted")).is_err());
    assert!(
        serde_json::from_value::<MetadataCandidateFieldDecision>(json!({"fieldName":"title"}))
            .is_err()
    );
}

#[test]
fn strict_public_requests_exclude_core_observations_but_keep_original_nested_tolerance() {
    let request = MetadataRequestV1::Update {
        item_id: " raw\0ID ".into(),
        patch: LiteratureMetadataPatch::Title("  title  ".into()),
    };
    let original = serde_json::to_value(&request).unwrap();
    assert_eq!(
        serde_json::from_value::<MetadataRequestV1>(original.clone()).unwrap(),
        request
    );
    for field in ["current", "header", "doi", "sql", "steps", "transaction"] {
        let mut invalid = original.clone();
        invalid[field] = json!({});
        assert!(serde_json::from_value::<MetadataRequestV1>(invalid).is_err());
    }
    let nested = json!({"kind":"fieldsApply","candidateId":"","decisions":[{"fieldName":"title","choice":"candidate","extra":"old-tolerance"}],"candidateTrust":"reviewable"});
    assert!(serde_json::from_value::<MetadataRequestV1>(nested).is_ok());
    assert!(serde_json::from_value::<MetadataResultV1>(json!({"kind":"done","item":{}})).is_err());
    assert_eq!(
        serde_json::to_value(MetadataResultV1::Done {}).unwrap(),
        json!({"kind":"done"})
    );
}

#[test]
fn internal_echoes_and_deferred_shapes_are_closed_without_creating_a_generic_step_language() {
    let input = MetadataInputV1::Reject {
        input: Box::new(MetadataRejectInputV1 {
            candidate_id: "raw".into(),
            import_result_id: Some("".into()),
        }),
    };
    let original = serde_json::to_value(&input).unwrap();
    assert_eq!(
        serde_json::from_value::<MetadataInputV1>(original.clone()).unwrap(),
        input
    );
    assert_eq!(original["input"]["importResultId"], json!(""));
    for mutate in [
        |v: &mut Value| v["input"]["draftJson"] = json!("not-needed"),
        |v: &mut Value| v["input"]["steps"] = json!([]),
        |v: &mut Value| v["input"]["candidateId"] = json!(null),
        |v: &mut Value| v["extra"] = json!(true),
    ] {
        let mut invalid = original.clone();
        mutate(&mut invalid);
        assert!(serde_json::from_value::<MetadataInputV1>(invalid).is_err());
    }
    assert!(serde_json::from_value::<MetadataTitleRuleV1>(json!("lowercase-ascii")).is_err());
    assert!(
        serde_json::from_value::<DeferredMetadataPatchV1>(
            json!({"status":"rejected","error":{"kind":"emptyTitle","private":1}})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<MetadataRejectionV1>(json!({"kind":"notFound","sql":"private"}))
            .is_err()
    );
}
