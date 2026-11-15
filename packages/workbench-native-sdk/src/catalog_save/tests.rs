use super::*;
use serde_json::{Value, json};

fn plan_value() -> Value {
    json!({
        "item":{"id":null,"itemType":"document","title":"Title","abstractText":"",
            "issuedYear":null,"containerTitle":"","conferenceName":"","proceedingsTitle":"",
            "place":"","volume":"","issue":"","pages":"","url":"","language":"",
            "bibtexKey":"","rawBibtex":null},
        "creators":[],"doi":null,"tags":["raw","raw"],
        "provenance":{"fields":["title"],"sourceKind":"user","confirmedByUser":true},
        "duplicates":{"normalizedTitle":"title","doiReason":"doi","doiConfidence":1.0,
            "titleReason":"normalized_title_year","titleConfidence":0.72}
    })
}

#[test]
fn draft_retains_original_required_fields_defaults_nulls_and_unknown_field_tolerance() {
    let draft: CatalogDraft = serde_json::from_value(json!({
        "itemType":"document","title":" raw ","legacyExtra":true,
        "creators":[{"familyName":"Family","givenName":"Given","legacyExtra":true}]
    }))
    .unwrap();
    assert_eq!(draft.id, None);
    assert_eq!(draft.title, " raw ");
    assert_eq!(draft.issued_year, None);
    assert_eq!(draft.raw_bibtex, None);
    assert_eq!(draft.source_kind, None);
    assert_eq!(draft.creators[0].literal_name, "");
    assert_eq!(draft.creators[0].role, "author");
    assert_eq!(
        serde_json::to_value(&draft).unwrap(),
        json!({"id":null,"itemType":"document","title":" raw ","abstractText":"",
            "issuedYear":null,"containerTitle":"","conferenceName":"","proceedingsTitle":"",
            "place":"","volume":"","issue":"","pages":"","doi":"","url":"",
            "language":"","bibtexKey":"","rawBibtex":null,
            "creators":[{"familyName":"Family","givenName":"Given","literalName":"","role":"author"}],
            "tags":[],"sourceKind":null})
    );
    for invalid in [
        json!({"title":"Title"}),
        json!({"itemType":"document"}),
        json!({"itemType":null,"title":"Title"}),
        json!({"itemType":"document","title":"Title","issuedYear":2147483648_i64}),
        json!({"itemType":"document","title":"Title","creators":[{"givenName":"Given"}]}),
    ] {
        assert!(serde_json::from_value::<CatalogDraft>(invalid).is_err());
    }
}

#[test]
fn pure_save_input_and_complete_plan_round_trip_without_executing_owners() {
    let input: CatalogSaveInput = serde_json::from_value(json!({
        "draft":{"id":" raw\u{0000} id ","itemType":"document","title":"Title"},
        "doi":{"display":"10.1000/Example","normalized":"10.1000/example"}
    }))
    .unwrap();
    assert_eq!(
        serde_json::from_slice::<CatalogSaveInput>(&serde_json::to_vec(&input).unwrap()).unwrap(),
        input
    );
    let original = json!({"kind":"planned","plan":plan_value()});
    let outcome: CatalogSaveOutcome = serde_json::from_value(original.clone()).unwrap();
    assert_eq!(serde_json::to_value(outcome).unwrap(), original);
    assert_eq!(CAPABILITY_ID, "literature.catalog-save");
    assert_eq!(CAPABILITY_VERSION, 1);
}

#[test]
fn new_save_containers_reject_injected_authority_and_wrong_field_shapes() {
    let original = json!({"kind":"planned","plan":plan_value()});
    for mutate in [
        |v: &mut Value| v["sql"] = json!("private"),
        |v: &mut Value| v["plan"]["steps"] = json!([]),
        |v: &mut Value| v["plan"]["item"]["table"] = json!("private"),
        |v: &mut Value| v["plan"]["provenance"]["store"] = json!(true),
        |v: &mut Value| v["plan"]["provenance"]["confirmedByUser"] = json!(1),
        |v: &mut Value| v["plan"]["duplicates"]["dataCall"] = json!({}),
        |v: &mut Value| v["plan"]["duplicates"]["doiConfidence"] = Value::Null,
        |v: &mut Value| v["plan"]["doi"] = json!({"display":"x","normalized":"x","path":"p"}),
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert!(serde_json::from_value::<CatalogSaveOutcome>(value).is_err());
    }
    for invalid in [
        json!({"draft":{"itemType":"document","title":"Title"}}),
        json!({"draft":{"itemType":"document","title":"Title"},"doi":null}),
        json!({"draft":{"itemType":"document","title":"Title"},"doi":{"display":"","normalized":""},"connection":{}}),
        json!({"draft":{"itemType":"document","title":"Title"},"doi":{"display":"","normalized":"","sql":"private"}}),
    ] {
        assert!(serde_json::from_value::<CatalogSaveInput>(invalid).is_err());
    }
}

#[test]
fn rejection_shapes_keep_the_original_reason_data_and_close_the_empty_variant() {
    let original = CatalogSaveOutcome::Rejected {
        reason: CatalogSaveRejection::UnsupportedType {
            item_type: " raw\0type ".into(),
        },
    };
    let value = serde_json::to_value(&original).unwrap();
    assert_eq!(
        value,
        json!({"kind":"rejected","reason":{"kind":"unsupportedType","itemType":" raw\0type "}})
    );
    assert_eq!(
        serde_json::from_value::<CatalogSaveOutcome>(value).unwrap(),
        original
    );
    let empty = CatalogSaveOutcome::Rejected {
        reason: CatalogSaveRejection::EmptyTitle,
    };
    assert_eq!(
        serde_json::to_value(empty).unwrap(),
        json!({"kind":"rejected","reason":{"kind":"emptyTitle"}})
    );
    for invalid in [
        json!({"kind":"rejected","reason":{"kind":"emptyTitle","extra":true}}),
        json!({"kind":"rejected","reason":{"kind":"unsupportedType"}}),
        json!({"kind":"rejected","reason":{"kind":"unsupportedType","itemType":3}}),
        json!({"kind":"rejected","reason":{"kind":"other"}}),
        json!({"kind":"rejected","reason":{"kind":"emptyTitle"},"plan":plan_value()}),
    ] {
        assert!(serde_json::from_value::<CatalogSaveOutcome>(invalid).is_err());
    }
}

#[test]
fn finite_catalog_save_calls_report_the_new_operation_without_changing_old_request_shapes() {
    use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
    let input: CatalogSaveInput = serde_json::from_value(json!({
        "draft":{"itemType":"document","title":"Title"},
        "doi":{"display":"","normalized":""}
    }))
    .unwrap();
    let encoded_input = serde_json::to_value(&input).unwrap();
    let call = CatalogInput::PrepareSave {
        input: Box::new(input),
    };
    assert_eq!(call.operation(), CatalogOperation::PrepareSave);
    let value = serde_json::to_value(&call).unwrap();
    assert_eq!(value, json!({"kind":"prepareSave","input":encoded_input}));
    assert_eq!(
        serde_json::from_value::<CatalogInput>(value.clone()).unwrap(),
        call
    );
    let mut invalid = value;
    invalid["sql"] = json!("private");
    assert!(serde_json::from_value::<CatalogInput>(invalid).is_err());
    let outcome = CatalogSaveOutcome::Rejected {
        reason: CatalogSaveRejection::EmptyTitle,
    };
    let reply = CatalogOutput::SavePlan { outcome };
    assert_eq!(reply.operation(), CatalogOperation::PrepareSave);
    let value = serde_json::to_value(&reply).unwrap();
    assert_eq!(
        value,
        json!({"kind":"savePlan","outcome":{"kind":"rejected","reason":{"kind":"emptyTitle"}}})
    );
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(value.clone()).unwrap(),
        reply
    );
    let mut invalid = value;
    invalid["steps"] = json!([]);
    assert!(serde_json::from_value::<CatalogOutput>(invalid).is_err());
}
