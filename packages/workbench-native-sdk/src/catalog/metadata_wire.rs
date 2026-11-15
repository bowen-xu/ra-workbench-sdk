use super::*;
use serde_json::{Value, json};

fn inputs() -> Vec<Value> {
    let draft = json!({"itemType":"document","title":" raw title ","legacyDraft":true});
    let current = json!({
        "id":"paper","itemType":"document","title":"Current","abstractText":"",
        "issuedYear":null,"containerTitle":"","conferenceName":"","proceedingsTitle":"",
        "place":"","volume":"","issue":"","pages":"","doi":"","url":"",
        "language":"","bibtexKey":"","readingStatus":"unread","creators":[],"tags":[],
        "attachments":[],"projectIds":[],"metadataSources":[],"createdAt":"raw","updatedAt":"raw"
    });
    let header = json!({"itemId":null,"sourceKind":"crossref","sourceReference":" raw ","importResultId":""});
    let doi = json!({"display":"doi:raw","normalized":"raw"});
    [
        json!({"kind":"update","input":{"itemId":" raw\u{0000}ID ","patch":{"fieldName":"title","value":" raw "},"doi":null}}),
        json!({"kind":"confirm","input":{"itemId":"paper","fieldNames":["title","doi","title"]}}),
        json!({"kind":"fullApply","input":{"candidateId":"candidate","header":header,"candidate":draft,"candidateNormalizedDoi":"raw","draft":draft,"doi":doi}}),
        json!({"kind":"fieldsApply","input":{"candidateId":"candidate","header":header,"candidate":draft,"current":current,"candidateDoi":doi,"currentNormalizedDoi":"","decisions":[{"fieldName":"title","choice":"current","legacyDecision":true}],"candidateTrust":"reviewable"}}),
        json!({"kind":"reject","input":{"candidateId":"candidate","importResultId":""}}),
    ]
    .into_iter()
    .map(|input| json!({"kind":"prepareMetadata","input":input}))
    .collect()
}

#[test]
fn all_five_metadata_inputs_and_the_closed_output_keep_the_operation_and_echo() {
    assert_eq!(
        serde_json::to_value(CatalogOperation::PrepareMetadata).unwrap(),
        json!("prepareMetadata")
    );
    for value in inputs() {
        let input: CatalogInput = serde_json::from_value(value).unwrap();
        assert_eq!(input.operation(), CatalogOperation::PrepareMetadata);
        let bytes = serde_json::to_vec(&input).unwrap();
        assert_eq!(
            serde_json::from_slice::<CatalogInput>(&bytes).unwrap(),
            input
        );
    }
    let value = json!({"kind":"metadataPreparation","outcome":{"kind":"reject","plan":{
        "input":{"candidateId":" raw\u{0000} ","importResultId":""},
        "zeroAffected":{"kind":"notFound"}
    }}});
    let output: CatalogOutput = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(output.operation(), CatalogOperation::PrepareMetadata);
    assert_eq!(serde_json::to_value(output).unwrap(), value);
}

#[test]
fn metadata_envelopes_reject_extra_authority_unknown_tags_and_wrong_shapes() {
    let original = inputs().remove(0);
    for mutate in [
        |v: &mut Value| v["sql"] = json!("private"),
        |v: &mut Value| v["input"]["steps"] = json!([]),
        |v: &mut Value| v["input"]["input"]["transaction"] = json!("private"),
        |v: &mut Value| v["input"]["input"]["itemId"] = json!(null),
        |v: &mut Value| v["input"]["kind"] = json!("executeMetadata"),
        |v: &mut Value| v["input"]["input"]["patch"]["fieldName"] = json!("unknown"),
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
    }
    for value in [
        json!({"kind":"metadataPreparation","outcome":{"kind":"reject","plan":{"input":{"candidateId":"x","importResultId":null},"zeroAffected":{"kind":"notFound"}},"steps":[]}}),
        json!({"kind":"metadataPreparation","outcome":{"kind":"confirm","outcome":{"status":"rejected","input":{"itemId":"x","fieldNames":[]},"error":{"kind":"invalidFields","reason":"raw","sql":"private"}}}}),
        json!({"kind":"metadataPreparation","outcome":{"kind":"confirm","outcome":{"status":"deferred","input":{"itemId":"x","fieldNames":[]}}}}),
        json!({"kind":"metadataPreparation","outcome":{"kind":"reject","plan":{"input":{"candidateId":"x","importResultId":false},"zeroAffected":{"kind":"notFound"}}}}),
    ] {
        assert!(serde_json::from_value::<CatalogOutput>(value).is_err());
    }
}

#[test]
fn catalog_wrapping_preserves_the_original_nested_metadata_tolerance_and_defaults() {
    let input: CatalogInput = serde_json::from_value(json!({
        "kind":"prepareMetadata","input":{"kind":"update","input":{
            "itemId":"x","patch":{"fieldName":"creators","ignored":true,"value":[{
                "familyName":" Raw ","givenName":" Name ","ignored":true
            }]},"doi":null
        }}
    }))
    .unwrap();
    let CatalogInput::PrepareMetadata { input } = input else {
        unreachable!()
    };
    let crate::metadata::MetadataInputV1::Update { input } = *input else {
        unreachable!()
    };
    let crate::metadata::LiteratureMetadataPatch::Creators(creators) = input.patch else {
        unreachable!()
    };
    assert_eq!(creators[0].family_name, " Raw ");
    assert_eq!(creators[0].literal_name, "");
    assert_eq!(creators[0].role, "author");
    let full: CatalogInput = serde_json::from_value(inputs().remove(2)).unwrap();
    let CatalogInput::PrepareMetadata { input } = full else {
        unreachable!()
    };
    let crate::metadata::MetadataInputV1::FullApply { input } = *input else {
        unreachable!()
    };
    assert_eq!(input.draft.title, " raw title ");
    assert!(input.draft.creators.is_empty());
    assert!(input.draft.tags.is_empty());
}
