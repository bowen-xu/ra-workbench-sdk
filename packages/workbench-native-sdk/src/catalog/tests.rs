use super::*;
use serde_json::json;

#[test]
fn closed_calls_round_trip_and_report_their_operation() {
    for (input, output, operation) in [
        (
            json!({"kind":"plan","request":{"kind":"list","query":null}}),
            json!({"kind":"plan","plan":{"kind":"all"}}),
            CatalogOperation::Plan,
        ),
        (
            json!({"kind":"select","selection":{"primary":{"rows":[]},"year":null}}),
            json!({"kind":"selection","ids":[]}),
            CatalogOperation::Select,
        ),
        (
            json!({"kind":"project","input":{"request":{"kind":"get","id":" raw "},"items":[]}}),
            json!({"kind":"projection","outcome":{"kind":"notFound"}}),
            CatalogOperation::Project,
        ),
    ] {
        let parsed: CatalogInput = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(parsed.operation(), operation);
        assert_eq!(serde_json::to_value(parsed).unwrap(), input);
        let parsed: CatalogOutput = serde_json::from_value(output.clone()).unwrap();
        assert_eq!(parsed.operation(), operation);
        assert_eq!(serde_json::to_value(parsed).unwrap(), output);
    }
}

#[test]
fn new_wire_containers_reject_unknown_fields_and_wrong_shapes() {
    for input in [
        json!({"kind":"plan","request":{"kind":"list","query":null,"sql":"private"}}),
        json!({"kind":"select","selection":{"primary":{"rows":[]},"year":null,"connection":{}}}),
        json!({"kind":"project","input":{"request":{"kind":"get","id":1},"items":[]}}),
        json!({"kind":"project","input":{"request":{"kind":"get","id":"id"},"items":[{"main":{"rows":[]},"related":null,"store":{}}]}}),
        json!({"kind":"plan","request":{"kind":"get","id":"id"},"method":"other"}),
    ] {
        assert!(serde_json::from_value::<CatalogInput>(input).is_err());
    }
    assert!(
        serde_json::from_value::<CatalogOutput>(
            json!({"kind":"projection","outcome":{"kind":"notFound","items":[]}})
        )
        .is_err()
    );
}

#[test]
fn creator_defaults_and_legacy_input_tolerance_remain_unchanged() {
    let creator: CatalogCreator = serde_json::from_value(json!({
        "familyName":" Raw ","givenName":"Name","legacyExtra":true,
    }))
    .unwrap();
    assert_eq!(creator.literal_name, "");
    assert_eq!(creator.role, "author");
    assert_eq!(
        serde_json::to_string(&creator).unwrap(),
        "{\"familyName\":\" Raw \",\"givenName\":\"Name\",\"literalName\":\"\",\"role\":\"author\"}"
    );
}

#[test]
fn nal_query_calls_keep_the_ast_inside_the_original_json_codec() {
    let row = crate::nal_query::StoredRow {
        revision: -7,
        definitions_json: " [] ".into(),
        cache_json: Some("{\"legacy\":true}".into()),
        legacy_imported: false,
    };
    let input = CatalogInput::ReadNalQueries { row: row.clone() };
    let encoded = serde_json::to_vec(&input).unwrap();
    assert_eq!(
        serde_json::from_slice::<CatalogInput>(&encoded).unwrap(),
        input
    );
    assert_eq!(input.operation(), CatalogOperation::ReadNalQueries);
    let output = CatalogOutput::NalQueries {
        outcome: crate::nal_query::ProjectionOutcome::Success { row },
    };
    assert_eq!(output.operation(), input.operation());
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(serde_json::to_value(&output).unwrap()).unwrap(),
        output
    );
    let value = json!({"kind":"prepareNalQuerySave","content":{
        "definitionsJson":"[]","cacheJson":"null","legacyImported":true
    }});
    let parsed: CatalogInput = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(parsed.operation(), CatalogOperation::PrepareNalQuerySave);
    assert_eq!(serde_json::to_value(parsed).unwrap(), value);
}

#[test]
fn nal_query_wire_rejects_extra_authority_and_altered_field_types() {
    for value in [
        json!({"kind":"prepareNalQuerySave","content":{"definitionsJson":"[]","cacheJson":null,"legacyImported":true},"transaction":"x"}),
        json!({"kind":"prepareNalQuerySave","content":{"definitionsJson":[],"cacheJson":null,"legacyImported":true}}),
        json!({"kind":"readNalQueries","row":{"revision":0,"definitionsJson":"[]","cacheJson":null,"legacyImported":false,"sql":"private"}}),
        json!({"kind":"readNalQueries","row":{"revision":"0","definitionsJson":"[]","cacheJson":null,"legacyImported":false}}),
    ] {
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
    }
    assert!(
        serde_json::from_value::<CatalogOutput>(json!({
            "kind":"nalQueries","outcome":{"status":"rejected",
            "reason":{"kind":"invalidStructure","fallback":true}}
        }))
        .is_err()
    );
}
