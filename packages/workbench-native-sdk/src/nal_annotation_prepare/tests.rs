use super::*;
use crate::{
    catalog::{CatalogInput, CatalogOperation, CatalogOutput},
    literature_trace_protocol as wire,
};
use serde_json::{Value, json};

fn annotation() -> Value {
    json!({"id":" annotation ","targetKind":"concept","targetId":" target ","notePageId":" page "})
}

fn raw() -> Value {
    json!({"revision":-1,"concepts":[],"statements":[],"annotations":[annotation()],"relationConceptIds":[]})
}

fn input() -> Value {
    json!({
        "bootstrap":{
            "source":{
                "legacyImported":{"state":"available","value":true},
                "collections":{"state":"skipped"},"relationTypes":{"state":"skipped"},
                "relatedFieldUsed":{"state":"skipped"},"relations":{"state":"skipped"},
                "memberships":{"state":"skipped"},"assignments":{"state":"skipped"},
                "repairVersion":{"state":"available","value":1},"repairRecords":{"state":"skipped"},
                "cleanupExists":{"state":"available","value":false},
                "rawState":{"state":"available","value":raw()},
                "occupiedNameKeys":{"state":"available","value":[]},
                "configuredEmbedding":{"state":"available","value":null}
            },
            "probes":{
                "concepts":[],"termKeys":[],"statementCount":0,
                "representationRenderVersion":"concept-identity-v1","semanticNamespace":"accepted_concepts",
                "semanticSpace":{"state":"skipped"},"earliestUnavailable":null,"terminal":null
            },
            "facts":{"terms":[],"generation":{"state":"skipped"},"nextGeneration":{"state":"skipped"},"concepts":[]},
            "identities":{"concepts":[],"generationId":null,"statementIds":[]}
        },
        "request":{"targetKind":"concept","targetId":" target ","title":" Raw title "},
        "identities":{"pageId":" proposed page ","annotationId":" proposed annotation "}
    })
}

fn preparation(decision: Value) -> Value {
    json!({
        "bootstrap":{
            "concepts":[],"import":{"kind":"skipped"},"repair":{"kind":"skipped"},
            "cleanup":{"kind":"skipped"},
            "finalProjection":{"kind":"prepared","rawState":raw(),"rules":[]},"terminal":null
        },
        "decision":decision
    })
}

#[test]
fn prevalidation_uses_only_the_exact_request_and_a_closed_result() {
    let request = json!({"targetKind":"concept","targetId":" raw ","title":"文".repeat(300)});
    let value = json!({"kind":"validateNalAnnotation","request":request});
    let parsed: CatalogInput = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(parsed.operation(), CatalogOperation::ValidateNalAnnotation);
    assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    for kind in ["valid", "invalidRequest"] {
        let value = json!({"kind":"nalAnnotationValidation","outcome":{"kind":kind}});
        let parsed: CatalogOutput = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(parsed.operation(), CatalogOperation::ValidateNalAnnotation);
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
        assert!(
            serde_json::from_value::<NalAnnotationValidation>(json!({"kind":kind,"sql":"hidden"}))
                .is_err()
        );
    }
    for invalid in [
        json!({"kind":"validateNalAnnotation","request":{"targetKind":"concept","targetId":"id","title":"Title","sql":"hidden"}}),
        json!({"kind":"validateNalAnnotation","request":{"targetKind":"concept","targetId":1,"title":"Title"}}),
        json!({"kind":"validateNalAnnotation","request":{"targetKind":"concept","targetId":"id","title":"Title"},"store":{}}),
    ] {
        assert!(serde_json::from_value::<CatalogInput>(invalid).is_err());
    }
}

#[test]
fn composite_containers_keep_raw_slots_and_all_four_decisions() {
    let value = json!({"kind":"prepareNalAnnotation","input":input()});
    let parsed: CatalogInput = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(parsed.operation(), CatalogOperation::PrepareNalAnnotation);
    assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    for decision in [
        json!({"kind":"deferredAfterBootstrap"}),
        json!({"kind":"existing","annotation":annotation()}),
        json!({"kind":"targetMissing"}),
        json!({"kind":"create","annotation":annotation(),"rawTitle":" Raw title ","link":{
            "kind":"readActive","annotations":[annotation()],"target":{"kind":"concept","id":" target "}
        }}),
    ] {
        let value = json!({"kind":"nalAnnotationPreparation","outcome":preparation(decision)});
        let parsed: CatalogOutput = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(parsed.operation(), CatalogOperation::PrepareNalAnnotation);
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
    let mut extra = input();
    extra["identities"]["blockId"] = json!("not-owned-here");
    assert!(serde_json::from_value::<NalAnnotationPrepareInput>(extra).is_err());
    let mut extra = input();
    extra["transaction"] = json!({});
    assert!(serde_json::from_value::<NalAnnotationPrepareInput>(extra).is_err());
    for kind in ["deferredAfterBootstrap", "targetMissing"] {
        assert!(
            serde_json::from_value::<NalAnnotationDecision>(
                json!({"kind":kind,"annotation":annotation()})
            )
            .is_err()
        );
    }
}

#[test]
fn link_stages_are_closed_and_preserve_the_complete_ordered_annotations() {
    let mut other = annotation();
    other["id"] = json!("second");
    let annotations = json!([annotation(), other, annotation()]);
    for value in [
        json!({"kind":"rejectedBeforeLoad","reason":"invalidAnnotationId"}),
        json!({"kind":"afterLoadRejected","annotations":annotations,"reason":"identityConflict"}),
        json!({"kind":"afterLoadRejected","annotations":annotations,"reason":"targetConflict"}),
        json!({"kind":"readActive","annotations":annotations,"target":{"kind":"concept","id":" raw "}}),
        json!({"kind":"readActive","annotations":annotations,"target":{"kind":"statement","id":" raw "}}),
        json!({"kind":"readActive","annotations":annotations,"target":{"kind":"invalidTargetKind"}}),
    ] {
        let parsed: NalAnnotationLinkPreparation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
    for invalid in [
        json!({"kind":"rejectedBeforeLoad","reason":"identityConflict"}),
        json!({"kind":"afterLoadRejected","annotations":[],"reason":"invalidAnnotationId"}),
        json!({"kind":"readActive","annotations":[],"target":{"kind":"invalidTargetKind","id":"hidden"}}),
        json!({"kind":"readActive","annotations":[],"target":{"kind":"concept","id":"id"},"active":true}),
    ] {
        assert!(serde_json::from_value::<NalAnnotationLinkPreparation>(invalid).is_err());
    }
}

#[test]
fn new_calls_use_the_same_v2_catalog_identity_and_snapshot_frame() {
    for operation in [
        CatalogOperation::ValidateNalAnnotation,
        CatalogOperation::PrepareNalAnnotation,
    ] {
        let mut request = wire::Request {
            protocol_version: wire::PROTOCOL_VERSION,
            plugin_id: wire::PLUGIN_ID.into(),
            package_key: "a".repeat(64),
            instance_id: "00000000-0000-4000-8000-000000000001".into(),
            request_id: "00000000-0000-4000-8000-000000000002".into(),
            body: wire::RequestBody::Initialize,
        };
        let snapshot = wire::SnapshotRef::catalog_input(&request, 123, "b".repeat(64));
        request.body = wire::RequestBody::Catalog {
            operation,
            snapshot,
        };
        let frame = wire::encode_request(&request).unwrap();
        assert_eq!(
            wire::decode_request(&frame[..frame.len() - 1]).unwrap(),
            request
        );
        let response = wire::Response::for_request(
            &request,
            wire::ResponseBody::CatalogResult {
                payload: wire::SnapshotRef::catalog_result(&request, 456, "c".repeat(64)),
            },
        );
        response.validate_for_request(&request).unwrap();
        let frame = wire::encode_response(&response).unwrap();
        assert_eq!(
            wire::decode_response(&frame[..frame.len() - 1]).unwrap(),
            response
        );
        let mut unrelated = request.clone();
        unrelated.request_id = "00000000-0000-4000-8000-000000000003".into();
        assert!(response.validate_for_request(&unrelated).is_err());
    }
}
