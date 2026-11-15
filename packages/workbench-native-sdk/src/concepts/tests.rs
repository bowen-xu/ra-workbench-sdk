use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::json;
fn draft() -> ConceptDraft {
    serde_json::from_value(json!({"preferredTerm":"词","label":"词`语境","explanation":"","disambiguation":"","domain":"","tradition":"","period":""})).unwrap()
}
#[test]
fn original_draft_codec_keeps_nullable_fields_order_unknowns_and_i64() {
    let mut value = serde_json::to_value(draft()).unwrap();
    value["future"] = json!(true);
    value["expectedRevision"] = json!(i64::MIN);
    let decoded: ConceptDraft = serde_json::from_value(value).unwrap();
    assert_eq!(decoded.expected_revision, Some(i64::MIN));
    assert_eq!(
        serde_json::to_string(&draft()).unwrap(),
        "{\"id\":null,\"preferredTerm\":\"词\",\"language\":null,\"label\":\"词`语境\",\"explanation\":\"\",\"disambiguation\":\"\",\"domain\":\"\",\"tradition\":\"\",\"period\":\"\",\"expectedRevision\":null,\"changeReason\":null}"
    );
    assert_eq!(
        serde_json::from_str::<ConceptDraft>("1")
            .unwrap_err()
            .to_string(),
        "invalid type: integer `1`, expected struct ConceptDraft at line 1 column 1"
    );
    assert!(
        serde_json::from_value::<ConceptDraft>(json!({"preferredTerm":"x","label":"x"})).is_err()
    );
}
#[test]
fn original_details_diagnostic_and_null_are_unchanged() {
    let value = json!({"label":"a","explanation":"","disambiguation":"","domain":"","tradition":"","period":"","future":true});
    let decoded: NewConceptDetails = serde_json::from_value(value).unwrap();
    assert_eq!(decoded.change_reason, None);
    assert_eq!(
        serde_json::from_str::<NewConceptDetails>("false")
            .unwrap_err()
            .to_string(),
        "invalid type: boolean `false`, expected struct NewConceptDetails at line 1 column 5"
    );
}
#[test]
fn finite_catalog_wire_has_exact_shape_and_no_authority_fields() {
    let input = CatalogInput::PrepareResearchConcept {
        input: Box::new(ConceptRequestV1::Search {
            query: " A_% ".into(),
        }),
    };
    let value = json!({"kind":"prepareResearchConcept","input":{"kind":"search","query":" A_% "}});
    assert_eq!(serde_json::to_value(&input).unwrap(), value);
    assert_eq!(input.operation(), CatalogOperation::PrepareResearchConcept);
    assert_eq!(
        serde_json::from_value::<CatalogInput>(value.clone()).unwrap(),
        input
    );
    let mut bad = value;
    bad["input"]["sql"] = json!("select");
    assert!(serde_json::from_value::<CatalogInput>(bad).is_err());
    let output = CatalogOutput::ResearchConceptPreparation {
        outcome: Box::new(ConceptPreparationV1::Rejected {
            input: Box::new(ConceptRequestV1::Save {
                draft: Box::new(draft()),
            }),
            reason: ConceptRejectionV1::InvalidNameLength,
        }),
    };
    assert_eq!(output.operation(), CatalogOperation::PrepareResearchConcept);
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(serde_json::to_value(&output).unwrap()).unwrap(),
        output
    );
    let ready = json!({"status":"ready","plan":{"kind":"save","draft":draft(),
        "details":{"label":"词`语境","explanation":"","disambiguation":"","domain":"","tradition":"","period":"","changeReason":null},
        "term":{"text":"词","normalizedText":"词","language":"","rejection":null},
        "rules":{"provenanceKind":"human_original","editorKind":"human","initialRevision":1,
            "termObjectKind":"term","conceptObjectKind":"concept","termReason":"manual_create",
            "conceptReason":"manual_create","newExpectedRejection":null}}});
    assert_eq!(
        serde_json::to_value(
            serde_json::from_value::<ConceptPreparationV1>(ready.clone()).unwrap()
        )
        .unwrap(),
        ready
    );
}
#[test]
fn closed_rejections_require_strings_and_keep_original_messages() {
    for value in [json!("unknown"), json!({"emptyTerm":null}), json!(1)] {
        assert!(serde_json::from_value::<ConceptRejectionV1>(value).is_err());
    }
    assert_eq!(
        ConceptRejectionV1::NewExpectedRevision.message(),
        "新建概念不能指定 expectedRevision"
    );
    assert_eq!(
        ConceptRejectionV1::MergedIdentity.message(),
        "旧概念 ID 已合并；请编辑当前保留节点或先拆回"
    );
}
