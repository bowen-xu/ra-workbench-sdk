use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::json;

fn input() -> UnreviewedSelectionInputV1 {
    UnreviewedSelectionInputV1 {
        resource_id: " raw\0资源 ".into(),
        resource_revision: i64::MIN,
        pending_field_ids: vec!["乙".into(), " 甲 ".into(), "乙".into(), "".into()],
        protected_field_ids: vec![" 甲 ".into(), " 甲 ".into()],
        reviewed_field_ids: vec!["\0".into(), "乙".into()],
    }
}

#[test]
fn catalog_selection_preserves_original_lists_and_exact_binding_fields() {
    let input = input();
    let wire = CatalogInput::SelectUnreviewedFields {
        input: Box::new(input.clone()),
    };
    let value = serde_json::to_value(&wire).unwrap();
    assert_eq!(
        value,
        json!({"kind":"selectUnreviewedFields","input":{
            "resourceId":" raw\0资源 ","resourceRevision":i64::MIN,
            "pendingFieldIds":["乙"," 甲 ","乙",""],
            "protectedFieldIds":[" 甲 "," 甲 "],"reviewedFieldIds":["\0","乙"]
        }})
    );
    assert_eq!(serde_json::from_value::<CatalogInput>(value).unwrap(), wire);
    assert_eq!(wire.operation(), CatalogOperation::SelectUnreviewedFields);
    // These are binding values, not another ID/version admission policy.
    let mut unvalidated = input;
    unvalidated.resource_id.clear();
    unvalidated.resource_revision = i64::MAX;
    assert_eq!(
        serde_json::from_value::<UnreviewedSelectionInputV1>(
            serde_json::to_value(&unvalidated).unwrap()
        )
        .unwrap(),
        unvalidated
    );
}

#[test]
fn selection_contract_rejects_missing_extra_and_wrongly_typed_authority() {
    let original = serde_json::to_value(input()).unwrap();
    for field in [
        "resourceId",
        "resourceRevision",
        "pendingFieldIds",
        "protectedFieldIds",
        "reviewedFieldIds",
    ] {
        let mut bad = original.clone();
        bad.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<UnreviewedSelectionInputV1>(bad).is_err());
        let mut bad = original.clone();
        bad[field] = json!(null);
        assert!(serde_json::from_value::<UnreviewedSelectionInputV1>(bad).is_err());
    }
    for (field, value) in [
        ("sql", json!("private")),
        ("pendingFieldIds", json!(["ok", 1])),
        ("resourceRevision", json!(1.5)),
    ] {
        let mut bad = original.clone();
        bad[field] = value;
        assert!(serde_json::from_value::<UnreviewedSelectionInputV1>(bad).is_err());
    }
    let mut bad = json!({"kind":"selectUnreviewedFields","input":original});
    bad["writer"] = json!(true);
    assert!(serde_json::from_value::<CatalogInput>(bad).is_err());
}

#[test]
fn result_has_only_bound_input_and_selected_ids() {
    let wire = CatalogOutput::UnreviewedFields {
        selection: Box::new(UnreviewedSelectionV1 {
            input: Box::new(input()),
            selected_field_ids: vec!["".into(), "".into()],
        }),
    };
    let value = serde_json::to_value(&wire).unwrap();
    assert_eq!(value["kind"], "unreviewedFields");
    assert_eq!(value["selection"]["selectedFieldIds"], json!(["", ""]));
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(value.clone()).unwrap(),
        wire
    );
    assert_eq!(wire.operation(), CatalogOperation::SelectUnreviewedFields);
    let mut bad = value.clone();
    bad["selection"]["revision"] = json!(2);
    assert!(serde_json::from_value::<CatalogOutput>(bad).is_err());
    let mut bad = value;
    bad["selectedFieldIds"] = json!([]);
    assert!(serde_json::from_value::<CatalogOutput>(bad).is_err());
}
