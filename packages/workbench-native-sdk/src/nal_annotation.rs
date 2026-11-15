//! Pure NAL annotation shapes; no database, note owner or execution capability.
use serde::{Deserialize, Serialize};

/// The original annotation identity and its Core-owned note reference.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalAnnotation {
    pub id: String,
    pub target_kind: String,
    pub target_id: String,
    pub note_page_id: String,
}

/// Preserves the original desktop request shape and raw input bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalAnnotationRequest {
    pub target_kind: String,
    pub target_id: String,
    pub title: String,
}

/// Original domain state reduced to the inputs needed by this one decision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NalAnnotationSnapshot {
    pub annotations: Vec<NalAnnotation>,
    pub target_exists: bool,
}

/// A domain decision, not a write receipt or a transferable transaction.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NalAnnotationPlan {
    Existing {
        annotation: NalAnnotation,
    },
    Create {
        target_kind: String,
        target_id: String,
        title: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn original_request_and_annotation_json_shapes_remain_exact() {
        let request = json!({"targetKind":"concept","targetId":" concept ","title":" Raw title "});
        let decoded: NalAnnotationRequest = serde_json::from_value(request.clone()).unwrap();
        assert_eq!(decoded.target_id, " concept ");
        assert_eq!(decoded.title, " Raw title ");
        assert_eq!(serde_json::to_value(decoded).unwrap(), request);
        let annotation = json!({"id":"annotation","targetKind":"statement","targetId":"target","notePageId":"original-note"});
        let decoded: NalAnnotation = serde_json::from_value(annotation.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), annotation);
    }

    #[test]
    fn original_contracts_reject_unknown_missing_or_wrongly_typed_fields() {
        let request = json!({"targetKind":"concept","targetId":"id","title":"Title"});
        for invalid in [
            json!({"targetKind":"concept","targetId":"id","title":"Title","sql":"no"}),
            json!({"target_kind":"concept","targetId":"id","title":"Title"}),
            json!({"targetKind":"concept","targetId":"id"}),
            json!({"targetKind":"concept","targetId":1,"title":"Title"}),
        ] {
            assert!(serde_json::from_value::<NalAnnotationRequest>(invalid).is_err());
        }
        assert!(serde_json::from_value::<NalAnnotationRequest>(request).is_ok());
        for invalid in [
            json!({"id":"a","targetKind":"concept","targetId":"id","notePageId":"n","status":"trashed"}),
            json!({"id":"a","targetKind":"concept","targetId":"id"}),
            json!({"id":"a","targetKind":"concept","targetId":"id","notePageId":null}),
        ] {
            assert!(serde_json::from_value::<NalAnnotation>(invalid).is_err());
        }
    }

    #[test]
    fn snapshot_and_plan_round_trip_only_their_typed_shapes() {
        let annotation = NalAnnotation {
            id: "a".into(),
            target_kind: "concept".into(),
            target_id: "c".into(),
            note_page_id: "n".into(),
        };
        let snapshot = NalAnnotationSnapshot {
            annotations: vec![annotation.clone()],
            target_exists: false,
        };
        let wire = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(wire["targetExists"], false);
        assert_eq!(
            serde_json::from_value::<NalAnnotationSnapshot>(wire).unwrap(),
            snapshot
        );
        for plan in [
            NalAnnotationPlan::Existing { annotation },
            NalAnnotationPlan::Create {
                target_kind: "statement".into(),
                target_id: " raw ".into(),
                title: " raw title ".into(),
            },
        ] {
            let wire = serde_json::to_value(&plan).unwrap();
            assert_eq!(
                serde_json::from_value::<NalAnnotationPlan>(wire).unwrap(),
                plan
            );
        }
        assert!(
            serde_json::from_value::<NalAnnotationSnapshot>(
                json!({"annotations":[],"targetExists":true,"connection":"no"})
            )
            .is_err()
        );
        assert!(serde_json::from_value::<NalAnnotationPlan>(json!({"kind":"create","targetKind":"concept","targetId":"c","title":"Title","transaction":"no"})).is_err());
    }
}
