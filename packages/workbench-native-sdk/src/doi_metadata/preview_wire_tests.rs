use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::{Value, json};

fn translation() -> Value {
    json!({
        "draft":{"itemType":"journalArticle","title":" raw title ","legacyField":true},
        "rawPayload":" raw\u{0000}payload ","sourceKind":"doi.org:csl-json","warnings":[]
    })
}

#[test]
fn preview_is_one_operation_with_three_complete_owned_input_shapes() {
    assert_eq!(
        serde_json::to_value(CatalogOperation::DoiPreview).unwrap(),
        json!("doiPreview")
    );
    let response = json!({"contentType":"application/json","body":"{}","finalHttps":true});
    for input in [
        json!({"kind":"start","rawInput":" raw\u{0000}DOI ","normalizedDoi":null}),
        json!({"kind":"translate","normalizedDoi":"10.1000/raw","resolver":{"Ok":response},"publisher":null}),
        json!({"kind":"translate","normalizedDoi":"10.1000/raw","resolver":{"Err":{"kind":"notFound"}},"publisher":{"Err":{"kind":"read","status":200,"cause":"safe"}}}),
        json!({"kind":"candidate","id":" id ","importJobId":" job ","itemId":null,"normalizedDoi":"10.1000/raw","translation":translation(),"current":null,"currentNormalizedDoi":""}),
    ] {
        let input: CatalogInput = serde_json::from_value(json!({
            "kind":"doiPreview","input":input
        }))
        .unwrap();
        assert_eq!(input.operation(), CatalogOperation::DoiPreview);
        assert_eq!(
            serde_json::from_slice::<CatalogInput>(&serde_json::to_vec(&input).unwrap()).unwrap(),
            input
        );
    }
}

#[test]
fn preview_outcomes_roundtrip_and_original_preview_field_order_is_retained() {
    let preview = json!({
        "id":"candidate","importJobId":"job","itemId":null,
        "sourceKind":"doi.org:csl-json","sourceReference":"10.1000/raw",
        "draft":{"itemType":"journalArticle","title":"Title"},"diffs":[]
    });
    let decoded: MetadataPreviewV1 = serde_json::from_value(preview).unwrap();
    assert!(decoded.warnings.is_empty());
    let bytes = serde_json::to_string(&decoded).unwrap();
    assert!(bytes.starts_with(concat!(
        "{\"id\":\"candidate\",\"importJobId\":\"job\",\"itemId\":null,",
        "\"sourceKind\":\"doi.org:csl-json\",\"sourceReference\":\"10.1000/raw\",\"draft\":"
    )));
    assert!(bytes.ends_with("\"diffs\":[]}"));
    for outcome in [
        json!({"status":"started","normalizedDoi":"10.1000/raw","sourceKind":"doi","finishStates":{"noFailed":"completed","noImported":"failed","mixed":"completed_with_errors"},"resolverAccept":"application/json","publisherAccept":"text/html,application/xhtml+xml","resolverLimit":4194304,"publisherLimit":2097152}),
        json!({"status":"needsPublisher"}),
        json!({"status":"translated","translation":translation()}),
        json!({"status":"candidate","preview":decoded,"rawPayload":" raw\u{0000}payload "}),
        json!({"status":"rejected","code":"connector_error","message":"safe"}),
    ] {
        let output: CatalogOutput = serde_json::from_value(json!({
            "kind":"doiPreview","outcome":outcome
        }))
        .unwrap();
        assert_eq!(output.operation(), CatalogOperation::DoiPreview);
        assert_eq!(
            serde_json::from_slice::<CatalogOutput>(&serde_json::to_vec(&output).unwrap()).unwrap(),
            output
        );
    }
}

#[test]
fn new_envelopes_are_closed_without_narrowing_the_original_draft() {
    let original = json!({"kind":"doiPreview","input":{
        "kind":"candidate","id":"x","importJobId":"job","itemId":null,
        "normalizedDoi":"10.1000/raw","translation":translation(),"current":null,
        "currentNormalizedDoi":""
    }});
    let decoded: CatalogInput = serde_json::from_value(original.clone()).unwrap();
    let CatalogInput::DoiPreview { input } = decoded else {
        unreachable!()
    };
    let DoiPreviewInputV1::Candidate {
        translation: decoded_translation,
        ..
    } = *input
    else {
        unreachable!()
    };
    assert_eq!(decoded_translation.draft.title, " raw title ");
    assert!(decoded_translation.draft.tags.is_empty());
    for mutate in [
        |v: &mut Value| v["sql"] = json!("forbidden"),
        |v: &mut Value| v["input"]["steps"] = json!([]),
        |v: &mut Value| v["input"]["translation"]["connection"] = json!("forbidden"),
        |v: &mut Value| v["input"]["kind"] = json!("fetchUrl"),
        |v: &mut Value| v["input"]["currentNormalizedDoi"] = json!(false),
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
    }
    for outcome in [
        json!({"status":"needsPublisher","url":"forbidden"}),
        json!({"status":"translated","translation":translation(),"steps":[]}),
        json!({"status":"rejected","code":"x","message":"safe","sql":"forbidden"}),
        json!({"status":"execute","rows":[]}),
    ] {
        assert!(
            serde_json::from_value::<CatalogOutput>(json!({"kind":"doiPreview","outcome":outcome}))
                .is_err()
        );
    }
}
