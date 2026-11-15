use super::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("snapshot.json")).unwrap()
}

#[test]
fn original_nested_snapshot_preserves_exact_field_order_and_mixed_case() {
    let raw = include_str!("snapshot.json").trim_end();
    let decoded: DuplicateMergeSnapshot = serde_json::from_str(raw).unwrap();
    assert_eq!(serde_json::to_string(&decoded).unwrap(), raw);
    let classification = decoded.classification.as_ref().unwrap();
    let nal = classification.nal.as_ref().unwrap();
    assert_eq!(nal.after.len(), 2);
    assert_eq!(nal.after_annotations[1].note_page_id, "core-note-new");
    assert_eq!(decoded.attachment_ids, ["attach", "attach"]);
    assert_eq!(classification.before_memberships[0].collection_id, "old");
    assert_eq!(classification.after_assignments[1].relation_id, "new");
    assert_eq!(serde_json::to_value(decoded.clone()).unwrap(), fixture());
}

#[test]
fn original_optional_parts_and_unknown_snapshot_fields_remain_compatible() {
    for explicit_null in [false, true] {
        let mut value = fixture();
        if explicit_null {
            value["classification"] = Value::Null;
        } else {
            value.as_object_mut().unwrap().remove("classification");
        }
        value.as_object_mut().unwrap().remove("mergedArchivedAt");
        let decoded: DuplicateMergeSnapshot = serde_json::from_value(value).unwrap();
        assert!(decoded.classification.is_none());
        assert!(decoded.merged_archived_at.is_none());
        let serialized = serde_json::to_value(decoded).unwrap();
        assert!(serialized["classification"].is_null());
        assert!(serialized["mergedArchivedAt"].is_null());
    }
    for explicit_null in [false, true] {
        let mut value = fixture();
        if explicit_null {
            value["classification"]["nal"] = Value::Null;
        } else {
            value["classification"]
                .as_object_mut()
                .unwrap()
                .remove("nal");
        }
        let decoded: DuplicateMergeSnapshot = serde_json::from_value(value).unwrap();
        assert!(decoded.classification.unwrap().nal.is_none());
    }
    let mut value = fixture();
    value["futureOuter"] = json!({"synthetic": true});
    value["classification"]["futureClassification"] = json!(7);
    value["classification"]["nal"]["futureNal"] = json!(true);
    let decoded: DuplicateMergeSnapshot = serde_json::from_value(value).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), fixture());
}

#[test]
fn mandatory_fields_null_vectors_and_nal_snake_case_are_not_relaxed() {
    for field in [
        "candidateId",
        "attachmentIds",
        "identifierIds",
        "anchorIds",
        "addedProjectIds",
        "addedTagIds",
        "addedProvenanceFields",
        "createdReadingState",
    ] {
        let mut value = fixture();
        value.as_object_mut().unwrap().remove(field);
        assert!(
            serde_json::from_value::<DuplicateMergeSnapshot>(value).is_err(),
            "{field}"
        );
    }
    for pointer in [
        "/createdReadingState",
        "/attachmentIds",
        "/classification/beforeMemberships",
        "/classification/afterAssignments",
        "/classification/nal/before",
        "/classification/nal/after_annotations",
    ] {
        let mut value = fixture();
        *value.pointer_mut(pointer).unwrap() = Value::Null;
        assert!(
            serde_json::from_value::<DuplicateMergeSnapshot>(value).is_err(),
            "{pointer}"
        );
    }
    let mut value = fixture();
    value["classification"]["nal"]
        .as_object_mut()
        .unwrap()
        .remove("before_annotations");
    value["classification"]["nal"]["beforeAnnotations"] = json!([]);
    assert!(serde_json::from_value::<DuplicateMergeSnapshot>(value).is_err());
    let mut value = fixture();
    value["createdReadingState"] = json!("false");
    assert!(serde_json::from_value::<DuplicateMergeSnapshot>(value).is_err());
}

#[test]
fn original_membership_assignment_and_fact_codecs_still_reject_extra_fields() {
    for value in [
        json!({"itemId":"paper","collectionId":"collection","extra":true}),
        json!({"itemId":"paper"}),
        json!({"itemId":null,"collectionId":"collection"}),
    ] {
        assert!(serde_json::from_value::<CollectionMembership>(value).is_err());
    }
    for value in [
        json!({"itemId":"paper","relationId":"relation","extra":true}),
        json!({"itemId":"paper"}),
        json!({"itemId":"paper","relationId":null}),
    ] {
        assert!(serde_json::from_value::<CollectionAssignment>(value).is_err());
    }
    for pointer in [
        "/classification/beforeMemberships/0",
        "/classification/afterAssignments/0",
        "/classification/nal/before/0",
        "/classification/nal/after_annotations/0",
    ] {
        let mut value = fixture();
        value.pointer_mut(pointer).unwrap()["extra"] = json!(true);
        assert!(
            serde_json::from_value::<DuplicateMergeSnapshot>(value).is_err(),
            "{pointer}"
        );
    }
}

#[test]
fn original_wrong_type_error_names_survive_public_type_renaming() {
    // The original outer adapter exposes the safe serde cause as a diagnostic.
    // A new Rust API name must not change that existing stored-input error.
    for (name, error) in [
        (
            "MergeSnapshot",
            serde_json::from_str::<DuplicateMergeSnapshot>("7").unwrap_err(),
        ),
        (
            "MergeClassification",
            serde_json::from_str::<MergeClassificationSnapshot>("7").unwrap_err(),
        ),
        (
            "MergeNal",
            serde_json::from_str::<MergeNalSnapshot>("7").unwrap_err(),
        ),
        (
            "Membership",
            serde_json::from_str::<CollectionMembership>("7").unwrap_err(),
        ),
        (
            "Assignment",
            serde_json::from_str::<CollectionAssignment>("7").unwrap_err(),
        ),
    ] {
        assert_eq!(
            error.to_string(),
            format!("invalid type: integer `7`, expected struct {name} at line 1 column 1")
        );
    }
    // The two defaulted first fields are consumed logically even by an empty
    // sequence, so the old missing-field index is 1 rather than 0.
    for (name, fields, missing_field_index, error) in [
        (
            "MergeSnapshot",
            10,
            1,
            serde_json::from_str::<DuplicateMergeSnapshot>("[]").unwrap_err(),
        ),
        (
            "MergeClassification",
            5,
            1,
            serde_json::from_str::<MergeClassificationSnapshot>("[]").unwrap_err(),
        ),
        (
            "MergeNal",
            4,
            0,
            serde_json::from_str::<MergeNalSnapshot>("[]").unwrap_err(),
        ),
        (
            "Membership",
            2,
            0,
            serde_json::from_str::<CollectionMembership>("[]").unwrap_err(),
        ),
        (
            "Assignment",
            2,
            0,
            serde_json::from_str::<CollectionAssignment>("[]").unwrap_err(),
        ),
    ] {
        assert_eq!(
            error.to_string(),
            format!(
                "invalid length {missing_field_index}, expected struct {name} with {fields} elements at line 1 column 2"
            )
        );
    }
}
