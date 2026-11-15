use super::*;
use serde_json::json;

fn definition() -> Value {
    json!({"id":"q","name":"查询","conditions":[{
        "subject":{"kind":"variable","name":"x"},
        "predicate":{"kind":"concept","id":"domain"}
    }]})
}

fn row() -> StoredRow {
    StoredRow {
        revision: 7,
        definitions_json: format!(" [ {} ] ", definition()),
        cache_json: Some(" {\"version\":1,\"opaque\":[false,null]} ".into()),
        legacy_imported: true,
    }
}

#[test]
fn original_json_defaults_optional_fields_and_flat_stored_shape_are_preserved() {
    let content: Content = serde_json::from_value(json!({
        "definitions":[definition()],"legacyImported":false
    }))
    .unwrap();
    let expected = json!({"definitions":[{
        "id":"q","name":"查询","conditions":[{
            "copula":"inheritance","subject":{"kind":"variable","name":"x"},
            "predicate":{"kind":"concept","id":"domain"}
        }]
    }],"cache":null,"legacyImported":false});
    assert_eq!(serde_json::to_value(&content).unwrap(), expected);
    let stored = Stored {
        revision: -1,
        content,
    };
    let mut flat = expected;
    flat["revision"] = json!(-1);
    assert_eq!(serde_json::to_value(&stored).unwrap(), flat);
    assert_eq!(serde_json::from_value::<Stored>(flat).unwrap(), stored);
    let statement: Pattern = serde_json::from_value(json!({
        "kind":"statement","subject":{"kind":"paper","id":"p"},
        "predicate":{"kind":"concept","id":"c"}
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_value(statement).unwrap()["copula"],
        "inheritance"
    );
}

#[test]
fn original_strict_shapes_reject_unknown_fields_null_copula_and_invalid_groups() {
    let base = json!({"definitions":[definition()],"cache":null,"legacyImported":true});
    for location in ["content", "definition", "condition", "pattern"] {
        let mut value = base.clone();
        let object = match location {
            "content" => &mut value,
            "definition" => &mut value["definitions"][0],
            "condition" => &mut value["definitions"][0]["conditions"][0],
            _ => &mut value["definitions"][0]["conditions"][0]["subject"],
        };
        object["unexpected"] = json!(true);
        assert!(
            serde_json::from_value::<Content>(value).is_err(),
            "{location}"
        );
    }
    let mut invalid = base.clone();
    invalid["definitions"][0]["conditions"][0]["copula"] = Value::Null;
    assert!(serde_json::from_value::<Content>(invalid).is_err());
    let mut invalid = base;
    invalid["definitions"][0]["conditions"][0] =
        json!({"kind":"group","connector":"product","children":[]});
    assert!(serde_json::from_value::<Content>(invalid).is_err());
}

#[test]
fn row_codec_preserves_signed_revisions_opaque_cache_and_no_semantic_validation() {
    for revision in [i64::MIN, i64::MAX] {
        let mut raw = row();
        raw.revision = revision;
        // The original read accepts structurally valid but semantically invalid data.
        raw.definitions_json = "[{\"id\":\"\",\"name\":\"\",\"conditions\":[]}]".into();
        let stored = raw.decode().unwrap();
        assert_eq!(stored.revision, revision);
        assert_eq!(stored.content.definitions[0].id, "");
        assert_eq!(stored.content.cache.unwrap()["version"], 1);
    }
    let mut raw = row();
    raw.cache_json = Some("null".into());
    assert_eq!(
        raw.clone().decode().unwrap().content.cache,
        Some(Value::Null)
    );
    raw.cache_json = None;
    assert_eq!(raw.decode().unwrap().content.cache, None);
}

#[test]
fn row_codec_reports_definitions_before_cache_and_rejects_structural_errors() {
    let mut raw = row();
    raw.definitions_json = "not-json".into();
    raw.cache_json = Some("[".into());
    let expected = serde_json::from_str::<Vec<Definition>>("not-json").unwrap_err();
    assert_eq!(
        raw.clone().decode().unwrap_err().to_string(),
        expected.to_string()
    );
    raw.definitions_json = "[]".into();
    let expected = serde_json::from_str::<Value>("[").unwrap_err();
    assert_eq!(raw.decode().unwrap_err().to_string(), expected.to_string());
}

#[test]
fn finite_outcomes_and_raw_row_transport_have_strict_shapes() {
    let outcome = ProjectionOutcome::Success { row: row() };
    let encoded = serde_json::to_value(&outcome).unwrap();
    assert_eq!(encoded["status"], "success");
    assert_eq!(encoded["row"]["definitionsJson"], row().definitions_json);
    assert!(encoded["row"].get("definitions").is_none());
    assert_eq!(
        serde_json::from_value::<ProjectionOutcome>(encoded.clone()).unwrap(),
        outcome
    );
    let mut extra = encoded;
    extra["unexpected"] = json!(false);
    assert!(serde_json::from_value::<ProjectionOutcome>(extra).is_err());
    let plan = PrepareOutcome::Planned {
        plan: SavePlan {
            definitions_json: "[]".into(),
            cache_json: None,
            legacy_imported: false,
        },
    };
    let mut encoded = serde_json::to_value(&plan).unwrap();
    assert_eq!(
        serde_json::from_value::<PrepareOutcome>(encoded.clone()).unwrap(),
        plan
    );
    encoded["plan"]["revision"] = json!(1);
    assert!(serde_json::from_value::<PrepareOutcome>(encoded).is_err());
    for reason in [
        Rejection::TooLarge,
        Rejection::InvalidDefinition,
        Rejection::InvalidHierarchy,
        Rejection::MissingParent,
        Rejection::InvalidOutputVariables,
        Rejection::InvalidStructure,
    ] {
        let mut encoded = serde_json::to_value(reason).unwrap();
        assert_eq!(
            serde_json::from_value::<Rejection>(encoded.clone()).unwrap(),
            reason
        );
        encoded["message"] = json!("not part of the codec");
        assert!(serde_json::from_value::<Rejection>(encoded).is_err());
    }
}
