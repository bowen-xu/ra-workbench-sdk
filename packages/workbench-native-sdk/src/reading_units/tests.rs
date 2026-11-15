use super::*;
use serde_json::json;

#[test]
fn original_draft_accepts_missing_optional_and_unknown_fields_but_keeps_strings() {
    let value = json!({"unitKind":"unknown-kind","title":"","body":"x","epistemicRole":"unknown-role","oldExtra":true});
    let draft: StructuredReadingUnitDraft = serde_json::from_value(value).unwrap();
    assert!(draft.id.is_none() && draft.anchor_id.is_none() && draft.expected_revision.is_none());
    assert_eq!(draft.unit_kind, "unknown-kind");
    let input = ReadingUnitRequestV1::Save {
        draft: Box::new(draft),
    };
    let encoded = serde_json::to_value(&input).unwrap();
    assert_eq!(
        serde_json::from_value::<ReadingUnitRequestV1>(encoded).unwrap(),
        input
    );
}
#[test]
fn original_return_omits_none_fields_and_preserves_full_template_shape() {
    let unit = StructuredReadingUnit {
        template_field: None,
        id: "u".into(),
        project_id: None,
        project_title: None,
        paper_id: Some("p".into()),
        paper_title: Some("Paper".into()),
        unit_kind: "other".into(),
        title: "Title".into(),
        body: "Body".into(),
        provenance_kind: "ai_accepted_unchanged".into(),
        epistemic_role: "working_note".into(),
        revision: i64::MAX,
        evidence_count: 2,
        created_at: "created".into(),
        updated_at: "updated".into(),
    };
    let value = serde_json::to_value(&unit).unwrap();
    assert!(value.get("templateField").is_none() && value.get("projectId").is_none());
    assert_eq!(value["revision"].as_i64(), Some(i64::MAX));
    assert_eq!(
        serde_json::from_value::<StructuredReadingUnit>(value).unwrap(),
        unit
    );
    assert!(
        serde_json::from_value::<ReadingUnitTemplateField>(
            json!({"portraitCandidateId":"p","fieldId":"f","extra":1})
        )
        .is_err()
    );
}
#[test]
fn list_operation_roundtrips_original_filters_and_rejects_unknown_rejection_safely() {
    let input = ReadingUnitRequestV1::List {
        project_id: Some(" ".into()),
        paper_id: None,
    };
    let call = crate::catalog::CatalogInput::PrepareReadingUnit {
        input: Box::new(input),
    };
    assert_eq!(
        call.operation(),
        crate::catalog::CatalogOperation::PrepareReadingUnit
    );
    assert_eq!(
        serde_json::from_value::<crate::catalog::CatalogInput>(
            serde_json::to_value(&call).unwrap()
        )
        .unwrap(),
        call
    );
    let error = serde_json::from_str::<ReadingUnitRejectionV1>("\"private invalid value\"")
        .unwrap_err()
        .to_string();
    assert!(!error.contains("private invalid value"));
}
