use super::*;
use serde_json::json;

#[test]
fn original_seven_mutations_keep_exact_tags_raw_fields_and_strict_shapes() {
    for value in [
        json!({"kind":"delete_concept","id":" raw "}),
        json!({"kind":"set_concept_kind","conceptId":" raw ","conceptKind":"relation"}),
        json!({"kind":"set_transitivity","relationConceptId":" raw ","enabled":false}),
        json!({"kind":"add_statements","statements":[{"id":" s ","subject":{"kind":"concept","id":" c "},"predicate":{"kind":"paper","id":" p "},"origin":"human"}]}),
        json!({"kind":"delete_statement","id":" raw "}),
        json!({"kind":"link_annotation","annotation":{"id":" a ","targetKind":"concept","targetId":" c ","notePageId":" n "}}),
        json!({"kind":"unlink_annotation","id":" raw "}),
    ] {
        let parsed: NalMutation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
        let mut extra = value;
        extra["sql"] = json!("hidden");
        assert!(serde_json::from_value::<NalMutation>(extra).is_err());
    }
    for value in [
        json!({"kind":"setTransitivity","relationConceptId":"id","enabled":false}),
        json!({"kind":"set_transitivity","relationConceptId":"id","enabled":0}),
        json!({"kind":"add_statements","statements":[{"id":"s","subject":{"kind":"variable","name":"x"},"predicate":{"kind":"concept","id":"c"},"origin":"human"}]}),
        json!({"kind":"link_annotation","annotation":{"id":"a","targetKind":"concept","targetId":"c","notePageId":"n","active":true}}),
    ] {
        assert!(serde_json::from_value::<NalMutation>(value).is_err());
    }
}

#[test]
fn finite_guards_round_trip_without_existence_predictions_or_sql_authority() {
    for value in [
        json!({"kind":"rejected","reason":"productArity"}),
        json!({"kind":"product","terms":[{"kind":"concept","id":" raw ","missingRejection":"missingTerm"}]}),
        json!({"kind":"paper","id":" raw ","missingRejection":"missingTerm"}),
    ] {
        let parsed: NalTermPreparation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
    assert!(
        serde_json::from_value::<NalTermPreparation>(
            json!({"kind":"concept","id":"c","missingRejection":"missingTerm","exists":true})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<NalTermPreparation>(json!({"kind":"query","sql":"hidden"}))
            .is_err()
    );
    for value in [
        json!({"kind":"readUsage","conceptKind":"ordinary","onUsed":{"kind":"reject","reason":"conceptUsedAsRelation"}}),
        json!({"kind":"readUsage","conceptKind":"relation","onUsed":{"kind":"continue"}}),
    ] {
        let parsed: NalConceptKindPreparation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
    assert!(
        serde_json::from_value::<NalUsageCondition>(json!({"kind":"continue","skipSql":true}))
            .is_err()
    );
    assert!(
        serde_json::from_value::<NalTransitivityAction>(json!({"kind":"disable","skipSql":true}))
            .is_err()
    );
}

#[test]
fn partial_statement_shapes_require_their_stage_and_preserve_json_strings() {
    let leaf = json!({"kind":"concept","id":"c","missingRejection":"missingTerm"});
    let rejected = json!({"kind":"rejected","reason":"termStructureTooLarge"});
    for value in [
        json!({"kind":"rejectedIdentity","id":" raw ","origin":"legacy","reason":"invalidStatementIdentityOrOrigin"}),
        json!({"kind":"subjectRejected","id":"s","origin":"human","subject":rejected}),
        json!({"kind":"predicateRejected","id":"s","origin":"human","subject":leaf,"predicate":rejected}),
        json!({"kind":"ready","id":"s","origin":"human","subject":leaf,"predicate":leaf,"subjectJson":"{\"kind\":\"concept\",\"id\":\"c\"}","predicateJson":" raw string \u{0000} "}),
    ] {
        let parsed: NalStatementPreparation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
    assert!(serde_json::from_value::<NalStatementPreparation>(json!({"kind":"ready","id":"s","origin":"human","subject":leaf,"predicate":leaf,"subjectJson":"{}"})).is_err());
    assert!(serde_json::from_value::<NalStatementPreparation>(json!({"kind":"subjectRejected","id":"s","origin":"human","subject":rejected,"insert":true})).is_err());
}

#[test]
fn the_single_new_catalog_operation_keeps_mutation_as_a_canonical_json_string() {
    use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
    let raw = json!({"revision":0,"concepts":[],"statements":[],"annotations":[],"relationConceptIds":[]});
    let bootstrap = json!({
        "source":{
            "legacyImported":{"state":"available","value":true},"collections":{"state":"skipped"},
            "relationTypes":{"state":"skipped"},"relatedFieldUsed":{"state":"skipped"},"relations":{"state":"skipped"},
            "memberships":{"state":"skipped"},"assignments":{"state":"skipped"},"repairVersion":{"state":"available","value":1},
            "repairRecords":{"state":"skipped"},"cleanupExists":{"state":"available","value":false},
            "rawState":{"state":"available","value":raw},"occupiedNameKeys":{"state":"available","value":[]},"configuredEmbedding":{"state":"available","value":null}
        },
        "probes":{"concepts":[],"termKeys":[],"statementCount":0,"representationRenderVersion":"concept-identity-v1","semanticNamespace":"accepted_concepts","semanticSpace":{"state":"skipped"},"earliestUnavailable":null,"terminal":null},
        "facts":{"terms":[],"generation":{"state":"skipped"},"nextGeneration":{"state":"skipped"},"concepts":[]},
        "identities":{"concepts":[],"generationId":null,"statementIds":[]}
    });
    let value = json!({"kind":"prepareNalMutation","input":{"bootstrap":bootstrap,"mutationJson":"{\"kind\":\"unlink_annotation\",\"id\":\" raw \"}"}});
    let parsed: CatalogInput = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(parsed.operation(), CatalogOperation::PrepareNalMutation);
    assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    let mut extra = value.clone();
    extra["input"]["mutation"] = json!({"kind":"unlink_annotation","id":"raw"});
    assert!(serde_json::from_value::<CatalogInput>(extra).is_err());
    let mut wrong = value;
    wrong["input"]["mutationJson"] = json!({"kind":"unlink_annotation","id":"raw"});
    assert!(serde_json::from_value::<CatalogInput>(wrong).is_err());
    let value = json!({"kind":"nalMutationPreparation","outcome":{
        "bootstrap":{"concepts":[],"import":{"kind":"skipped"},"repair":{"kind":"skipped"},"cleanup":{"kind":"skipped"},"finalProjection":{"kind":"prepared","rawState":raw,"rules":[]},"terminal":null},
        "decision":{"kind":"prepared","mutation":{"kind":"unlinkAnnotation","id":" raw "}},"ruleProjection":[]
    }});
    let parsed: CatalogOutput = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(parsed.operation(), CatalogOperation::PrepareNalMutation);
    assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    assert!(
        serde_json::from_value::<NalMutationDecision>(
            json!({"kind":"deferredAfterBootstrap","mutation":{}})
        )
        .is_err()
    );
}
