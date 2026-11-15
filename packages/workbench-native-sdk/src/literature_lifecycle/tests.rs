use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::{Value, json};

#[test]
fn lifecycle_shapes_preserve_original_strings_and_project_order() {
    assert_eq!(LifecycleRejectionCodeV1::NotFound.as_str(), "not_found");
    for request in [
        LifecycleRequestV1::Archive { item_id: "".into() },
        LifecycleRequestV1::Restore {
            item_id: " ".into(),
        },
        LifecycleRequestV1::Trash {
            item_id: "a\0b".into(),
        },
        LifecycleRequestV1::RestoreTrash {
            item_id: "中".into(),
        },
        LifecycleRequestV1::TrashMany {
            item_ids: vec!["b".into(), "a".into(), "b".into()],
        },
        LifecycleRequestV1::SetProjects {
            item_id: " raw ".into(),
            project_ids: vec!["b".into(), "a".into(), "b".into(), "".into()],
        },
    ] {
        let call = CatalogInput::PrepareLiteratureLifecycle {
            request: request.clone(),
        };
        let encoded = serde_json::to_vec(&call).unwrap();
        assert_eq!(
            serde_json::from_slice::<CatalogInput>(&encoded).unwrap(),
            call
        );
        assert_eq!(
            call.operation(),
            CatalogOperation::PrepareLiteratureLifecycle
        );
        let value: Value = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(value["kind"], "prepareLiteratureLifecycle");
        assert_eq!(value["request"], serde_json::to_value(&request).unwrap());
        let output = CatalogOutput::LiteratureLifecyclePreparation {
            outcome: LifecyclePreparationV1::Ready {
                request,
                trash_item_ids: vec![],
            },
        };
        assert_eq!(
            output.operation(),
            CatalogOperation::PrepareLiteratureLifecycle
        );
        assert_eq!(
            serde_json::from_slice::<CatalogOutput>(&serde_json::to_vec(&output).unwrap()).unwrap(),
            output
        );
    }
    assert_eq!(
        serde_json::to_value(LifecycleRequestV1::RestoreTrash {
            item_id: " x ".into()
        })
        .unwrap(),
        json!({"kind":"restoreTrash","itemId":" x "})
    );
    let rejection = LifecyclePreparationV1::Rejected {
        error: LifecycleRejectionV1 {
            code: LifecycleRejectionCodeV1::NotFound,
            message: "original message".into(),
        },
    };
    assert_eq!(
        serde_json::to_value(&rejection).unwrap(),
        json!({"status":"rejected","error":{"code":"not_found","message":"original message"}})
    );
}

#[test]
fn strict_lifecycle_wire_rejects_unknown_fields_types_and_missing_data() {
    for value in [
        json!({"kind":"archive","itemId":"id","sql":"never"}),
        json!({"kind":"archive","item_id":"id"}),
        json!({"kind":"archive","itemId":null}),
        json!({"kind":"archive","itemId":7}),
        json!({"kind":"trashMany","itemIds":"id"}),
        json!({"kind":"trashMany","itemIds":["id",1]}),
        json!({"kind":"setProjects","itemId":"id"}),
        json!({"kind":"setProjects","itemId":"id","projectIds":[],"extra":false}),
        json!({"kind":"deletePermanently","itemId":"id"}),
    ] {
        assert!(serde_json::from_value::<LifecycleRequestV1>(value).is_err());
    }
    for value in [
        json!({"status":"ready","request":{"kind":"archive","itemId":"id"},"trashItemIds":[],"extra":true}),
        json!({"status":"ready","request":{"kind":"archive","itemId":"id"}}),
        json!({"status":"rejected","error":{"code":"not_found","message":"original","extra":true}}),
        json!({"status":"rejected","error":{"code":"storage_error","message":"unknown rejection"}}),
    ] {
        assert!(serde_json::from_value::<LifecyclePreparationV1>(value).is_err());
    }
    assert!(
        serde_json::from_str::<LifecycleRequestV1>(
            r#"{"kind":"archive","itemId":"a","itemId":"b"}"#
        )
        .is_err()
    );
}
