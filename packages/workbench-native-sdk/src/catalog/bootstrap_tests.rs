use super::*;
use crate::nal_bootstrap::*;
use serde_json::{Value, json};

fn fixture() -> (BootstrapInputV1, BootstrapPreparationV1) {
    let raw_state = RawNalStateV1 {
        revision: -7,
        concepts: vec![],
        statements: vec![],
        annotations: vec![],
        relation_concept_ids: vec![],
    };
    let source = BootstrapSourceV1 {
        legacy_imported: SourceProbe::Available { value: true },
        collections: SourceProbe::Skipped {},
        relation_types: SourceProbe::Skipped {},
        related_field_used: SourceProbe::Skipped {},
        relations: SourceProbe::Skipped {},
        memberships: SourceProbe::Skipped {},
        assignments: SourceProbe::Skipped {},
        repair_version: SourceProbe::Available { value: 1 },
        repair_records: SourceProbe::Skipped {},
        cleanup_exists: SourceProbe::Available { value: false },
        raw_state: SourceProbe::Available {
            value: raw_state.clone(),
        },
        occupied_name_keys: SourceProbe::Skipped {},
        configured_embedding: SourceProbe::Skipped {},
    };
    let probes = BootstrapProbePreparationV1 {
        concepts: vec![],
        term_keys: vec![],
        statement_count: 0,
        representation_render_version: "concept-identity-v1".into(),
        semantic_namespace: "accepted_concepts".into(),
        semantic_space: SourceProbe::Skipped {},
        earliest_unavailable: None,
        terminal: None,
    };
    let input = BootstrapInputV1 {
        source,
        probes,
        facts: BootstrapProbeFactsV1 {
            terms: vec![],
            generation: SourceProbe::Skipped {},
            next_generation: SourceProbe::Skipped {},
            concepts: vec![],
        },
        identities: BootstrapIdentitiesV1 {
            concepts: vec![],
            generation_id: None,
            statement_ids: vec![],
        },
    };
    let plan = BootstrapPreparationV1 {
        concepts: vec![],
        import: ImportPreparationV1::Skipped {},
        repair: RepairPreparationV1::Skipped {},
        cleanup: CleanupPreparationV1::Skipped {},
        final_projection: StateProjectionV1::Prepared {
            raw_state,
            rules: vec![],
        },
        terminal: None,
    };
    (input, plan)
}

fn calls() -> Vec<(CatalogInput, CatalogOutput, CatalogOperation)> {
    let (input, plan) = fixture();
    vec![
        (
            CatalogInput::PrepareNalBootstrapProbes {
                source: Box::new(input.source.clone()),
            },
            CatalogOutput::NalBootstrapProbes {
                outcome: Box::new(input.probes.clone()),
            },
            CatalogOperation::PrepareNalBootstrapProbes,
        ),
        (
            CatalogInput::PrepareNalBootstrap {
                input: Box::new(input),
            },
            CatalogOutput::NalBootstrapPlan {
                outcome: Box::new(plan),
            },
            CatalogOperation::PrepareNalBootstrap,
        ),
    ]
}

#[test]
fn two_closed_bootstrap_calls_and_boxed_responses_round_trip_with_their_exact_operation() {
    for (input, output, operation) in calls() {
        let encoded = serde_json::to_vec(&input).unwrap();
        assert_eq!(
            serde_json::from_slice::<CatalogInput>(&encoded).unwrap(),
            input
        );
        assert_eq!(input.operation(), operation);
        assert_eq!(output.operation(), operation);
        assert_eq!(
            serde_json::to_value(&input).unwrap()["kind"],
            serde_json::to_value(operation).unwrap()
        );
        let encoded = serde_json::to_vec(&output).unwrap();
        assert_eq!(
            serde_json::from_slice::<CatalogOutput>(&encoded).unwrap(),
            output
        );
        assert!(serde_json::to_value(&output).unwrap()["outcome"].is_object());
    }
}

fn source(value: &mut Value) -> &mut Value {
    if value["kind"] == "prepareNalBootstrapProbes" {
        &mut value["source"]
    } else {
        &mut value["input"]["source"]
    }
}

#[test]
fn bootstrap_inputs_reject_extra_sql_steps_and_private_failure_details_without_decoding_future_facts()
 {
    for (input, _, _) in calls() {
        let original = serde_json::to_value(input).unwrap();
        for field in ["sql", "steps", "transaction"] {
            let mut value = original.clone();
            value[field] = json!([]);
            assert!(
                serde_json::from_value::<CatalogInput>(value).is_err(),
                "{field}"
            );
        }
        let mut value = original.clone();
        source(&mut value)["collections"] = json!({"state":"deferred","sqliteCause":"private"});
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
        let mut value = original.clone();
        source(&mut value)["legacyImported"] = json!({"state":"available","value":"true"});
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
        let mut value = original;
        source(&mut value)["rawState"]["value"]["statements"] = json!([{
            "id":"legacy","subjectJson":"not JSON","predicateJson":"null","origin":"human"
        }]);
        // The original decoder must run at its later named transaction phase.
        assert!(serde_json::from_value::<CatalogInput>(value).is_ok());
    }
}

#[test]
fn bootstrap_outputs_reject_unknown_phase_shapes_and_injected_execution_fields() {
    for (_, output, _) in calls() {
        let original = serde_json::to_value(output).unwrap();
        for phase in [
            json!("runArbitrarySql"),
            json!({"sql":"private"}),
            Value::Null,
        ] {
            let mut value = original.clone();
            value["outcome"]["terminal"] = json!({"phase":phase,"conceptKey":null,
                "statementId":null,"reason":{"kind":"deferred"}});
            assert!(serde_json::from_value::<CatalogOutput>(value).is_err());
        }
        let mut value = original.clone();
        value["outcome"]["terminal"] = json!({"phase":"finalLoad","conceptKey":null,
            "statementId":null,"reason":{"kind":"deferred","sql":"private"}});
        assert!(serde_json::from_value::<CatalogOutput>(value).is_err());
        let mut value = original;
        value["outcome"]["steps"] = json!([]);
        assert!(serde_json::from_value::<CatalogOutput>(value).is_err());
    }
}
