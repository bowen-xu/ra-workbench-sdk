use super::*;
use crate::{
    knowledge_snapshot::{KnowledgeConcept, KnowledgeTerm},
    nal_state::{NalState, NalTerm},
};
use serde_json::json;

#[test]
fn source_probe_empty_variants_and_call_keys_reject_hidden_authority() {
    for state in ["skipped", "deferred"] {
        let value = json!({"state":state});
        let _: SourceProbe<bool> = serde_json::from_value(value.clone()).unwrap();
        let mut extra = value;
        extra["sql"] = json!("hidden");
        assert!(serde_json::from_value::<SourceProbe<bool>>(extra).is_err());
    }
    for value in [
        json!({"state":"available","value":true,"handle":"private"}),
        json!({"state":"available"}),
        json!({"state":"unknown"}),
    ] {
        assert!(serde_json::from_value::<SourceProbe<bool>>(value).is_err());
    }
    for kind in [
        "membership",
        "tagged",
        "linkedPredicate",
        "subFieldPredicate",
        "repairPredicate",
    ] {
        let mut value = json!({"kind":kind});
        assert!(serde_json::from_value::<ConceptCallKeyV1>(value.clone()).is_ok());
        value["invoke"] = json!(true);
        assert!(serde_json::from_value::<ConceptCallKeyV1>(value).is_err());
    }
    let nullable: SourceProbe<Option<KnowledgeTerm>> =
        serde_json::from_value(json!({"state":"available","value":null})).unwrap();
    assert_eq!(nullable, SourceProbe::Available { value: None });
}

#[test]
fn original_knowledge_eight_and_fifteen_field_snapshots_keep_names_order_and_metadata() {
    let term = KnowledgeTerm {
        id: "t".into(),
        text: " Text ".into(),
        normalized_text: "text".into(),
        language: "".into(),
        provenance_kind: "human_original".into(),
        revision: i64::MAX,
        created_at: "sql-created".into(),
        updated_at: "sql-updated".into(),
    };
    let direct = serde_json::to_string(&term).unwrap();
    assert!(direct.starts_with(
        "{\"id\":\"t\",\"text\":\" Text \",\"normalizedText\":\"text\",\"language\":\"\""
    ));
    let value = serde_json::to_value(&term).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 8);
    assert_eq!(
        serde_json::from_value::<KnowledgeTerm>(value.clone()).unwrap(),
        term
    );
    assert_eq!(
        serde_json::from_str::<KnowledgeTerm>(&serde_json::to_string(&value).unwrap()).unwrap(),
        term
    );
    let concept = KnowledgeConcept {
        id: "c".into(),
        preferred_term: term.clone(),
        terms: vec![term],
        label: "Label".into(),
        explanation: "".into(),
        disambiguation: "".into(),
        domain: "".into(),
        tradition: "".into(),
        period: "".into(),
        provenance_kind: "human_original".into(),
        revision: i64::MIN,
        definition_count: 7,
        source_count: 9,
        created_at: "concept-sql-created".into(),
        updated_at: "concept-sql-updated".into(),
    };
    let direct = serde_json::to_string(&concept).unwrap();
    assert!(direct.starts_with("{\"id\":\"c\",\"preferredTerm\":"));
    let value = serde_json::to_value(&concept).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 15);
    assert_eq!(value["terms"][0], value["preferredTerm"]);
    assert_eq!(value["preferredTerm"]["createdAt"], "sql-created");
    assert_eq!(
        serde_json::from_str::<KnowledgeConcept>(&serde_json::to_string(&value).unwrap()).unwrap(),
        concept
    );
}

#[test]
fn fact_term_is_not_the_more_permissive_query_language_and_historical_strings_remain_strings() {
    for value in [
        json!({"kind":"variable","name":"x"}),
        json!({"kind":"concept","id":"c","extra":true}),
        json!({"kind":"statement","subject":{"kind":"concept","id":"c"},"predicate":{"kind":"paper","id":"p"}}),
    ] {
        assert!(serde_json::from_value::<NalTerm>(value).is_err());
    }
    let state: NalState = serde_json::from_value(json!({"revision":-7,"concepts":[{"id":"historical-id","label":"l","explanation":"","revision":-1,"conceptKind":"historical-string"}],"statements":[],"annotations":[],"rules":[{"id":"r","kind":"historical-rule","relationConceptId":"historical-id"}]})).unwrap();
    assert_eq!(state.concepts[0].concept_kind, "historical-string");
    assert_eq!(
        serde_json::to_value(state).unwrap()["rules"][0]["kind"],
        "historical-rule"
    );
}

#[test]
fn boxed_fixed_import_groups_keep_the_flat_wire_and_reject_extra_fields() {
    let value = json!({"kind":"prepared","membership":null,"tagged":null,"collections":[],
        "linkedPredicate":null,"typePredicates":[],"relatedFieldProbe":null,"subfieldPredicate":null,
        "linkedStatements":[],"relationStatements":[],"membershipStatements":[],"assignmentStatements":[]});
    let parsed: ImportPreparationV1 = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    let mut extra = value;
    extra["steps"] = json!([]);
    assert!(serde_json::from_value::<ImportPreparationV1>(extra).is_err());
}
