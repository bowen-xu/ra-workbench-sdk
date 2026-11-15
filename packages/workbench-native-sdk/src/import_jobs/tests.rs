use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::{Value, json};

#[test]
fn original_job_and_result_output_keep_order_nulls_and_unrestricted_strings() {
    let job = ImportedJob {
        id: " raw\0id ".into(),
        state: "legacy-state".into(),
        source_kind: "other-source".into(),
        total_count: 3,
        completed_count: 1,
        cancellation_requested: true,
        results: vec![ImportedResult {
            input_label: " raw label ".into(),
            raw_input: "{\"raw\":true}".into(),
            state: "pending".into(),
            item_id: None,
            error_message: Some(String::new()),
        }],
        created_at: "raw-created".into(),
        updated_at: "raw-updated".into(),
    };
    assert_eq!(job.id(), " raw\0id ");
    let encoded = serde_json::to_string(&job).unwrap();
    assert_eq!(
        encoded,
        r#"{"id":" raw\u0000id ","state":"legacy-state","sourceKind":"other-source","totalCount":3,"completedCount":1,"cancellationRequested":true,"results":[{"inputLabel":" raw label ","rawInput":"{\"raw\":true}","state":"pending","itemId":null,"errorMessage":""}],"createdAt":"raw-created","updatedAt":"raw-updated"}"#
    );
    assert_eq!(serde_json::from_str::<ImportedJob>(&encoded).unwrap(), job);
}

#[test]
fn requests_and_new_containers_are_closed_but_original_draft_defaults_remain() {
    for value in [
        json!({"kind":"bibtex","drafts":[{"itemType":"document","title":" raw ","legacy":true}]}),
        json!({"kind":"get","id":""}),
        json!({"kind":"list"}),
        json!({"kind":"cancel","id":" raw\0id "}),
    ] {
        let request: ImportJobsRequestV1 = serde_json::from_value(value.clone()).unwrap();
        let encoded = serde_json::to_vec(&request).unwrap();
        assert_eq!(
            serde_json::from_slice::<ImportJobsRequestV1>(&encoded).unwrap(),
            request
        );
        let mut invalid = value;
        invalid["sql"] = json!("private SQL must not be callable");
        assert!(serde_json::from_value::<ImportJobsRequestV1>(invalid).is_err());
    }
    let input: PrepareBibtexInputV1 = serde_json::from_value(json!({"inputs":[{
        "draft":{"itemType":"document","title":" raw ","legacy":true,
            "creators":[{"familyName":" Raw ","givenName":" Name ","legacy":true}]},
        "doi":{"display":"","normalized":""}
    }]}))
    .unwrap();
    assert_eq!(input.inputs[0].draft.creators[0].role, "author");
    assert_eq!(input.inputs[0].draft.creators[0].literal_name, "");
    assert_eq!(input.inputs[0].draft.title, " raw ");
    assert!(input.inputs[0].draft.tags.is_empty());
    for value in [
        json!({"status":"rejected","reason":{"kind":"emptyTitle","steps":[]},"message":"标题不能为空"}),
        json!({"status":"rejected","reason":{"kind":"emptyTitle"},"message":"标题不能为空","transaction":"private"}),
    ] {
        assert!(serde_json::from_value::<BibtexPreparationV1>(value).is_err());
    }
}

#[test]
fn both_new_catalog_operations_keep_exact_wire_shapes_and_result_identity() {
    for (value, operation) in [
        (
            json!({"kind":"prepareBibtex","input":{"inputs":[]}}),
            CatalogOperation::PrepareBibtex,
        ),
        (
            json!({"kind":"projectImportJobs","input":{"kind":"cancel","affectedRows":0}}),
            CatalogOperation::ProjectImportJobs,
        ),
    ] {
        let input: CatalogInput = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(input.operation(), operation);
        assert_eq!(serde_json::to_value(input).unwrap(), value);
        let mut invalid = value;
        invalid["program"] = json!("private");
        assert!(serde_json::from_value::<CatalogInput>(invalid).is_err());
    }
    for (value, operation) in [
        (
            json!({"kind":"bibtexPreparation","outcome":{"status":"rejected",
                "reason":{"kind":"emptyTitle"},"message":"标题不能为空"}}),
            CatalogOperation::PrepareBibtex,
        ),
        (
            json!({"kind":"importJobsProjection","outcome":{"status":"success",
                "result":{"kind":"done"}}}),
            CatalogOperation::ProjectImportJobs,
        ),
    ] {
        let output: CatalogOutput = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(output.operation(), operation);
        assert_eq!(serde_json::to_value(output).unwrap(), value);
    }
    assert_eq!(
        serde_json::to_value(ImportJobsProjectionInputV1::Jobs {
            expected_ids: Vec::new(),
            rows: Vec::new(),
        })
        .unwrap(),
        json!({"kind":"jobs","expectedIds":[],"rows":[]})
    );
    let invalid: Value = json!({"kind":"projectImportJobs","input":{
        "kind":"cancel","affectedRows":0,"sql":"private"}});
    assert!(serde_json::from_value::<CatalogInput>(invalid).is_err());
}
