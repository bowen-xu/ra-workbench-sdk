use super::*;
use serde_json::json;

fn diagnostic() -> Value {
    json!({"code":"TEXT_PATCH_JOURNAL_UNCONFIRMED","phase":"target-terminal","safeCause":"journal_sql_failed",
        "conversationId":Uuid::from_u128(1),"requestId":Uuid::from_u128(2),"callId":"provider-call",
        "callRequestId":format!("{}:provider-call",Uuid::from_u128(2)),
        "targetRequestId":format!("{}:provider-call:file:0",Uuid::from_u128(2)),
        "journalRequestId":format!("{}:provider-call:file:0",Uuid::from_u128(2)),
        "sqliteCode":"ConstraintViolation","sqliteExtendedCode":1811})
}

#[test]
fn closed_diagnostic_preserves_only_known_identity_and_safe_driver_evidence() {
    let value = diagnostic();
    let decoded = ToolOutcomeDiagnostic::try_from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&decoded).unwrap(), value);
    assert_eq!(
        serde_json::from_str::<Value>(&decoded.to_string()).unwrap(),
        value
    );
    let mut compile = json!({"code":"WORKSPACE_COMPILE_CLEANUP_REQUIRED","phase":"compile-output-cleanup",
        "safeCause":"ephemeral_output_cleanup_unconfirmed","conversationId":Uuid::from_u128(1),
        "requestId":Uuid::from_u128(2),"turnId":Uuid::from_u128(3),"contextSnapshotId":Uuid::from_u128(4),
        "manuscriptId":Uuid::from_u128(5),"leaseId":Uuid::from_u128(6),"resultId":Uuid::from_u128(7)});
    compile["requestId"] = json!(Uuid::from_u128(0xabcd).to_string().to_uppercase());
    let decoded =
        serde_json::to_value(ToolOutcomeDiagnostic::try_from_value(compile).unwrap()).unwrap();
    assert_eq!(decoded["requestId"], Uuid::from_u128(0xabcd).to_string());
    assert!(decoded.get("epoch").is_none());
    assert!(decoded.get("sqlFence").is_none());
}

#[test]
fn sql_operation_identity_is_preserved_and_must_not_be_nil() {
    let mut value = diagnostic();
    value["operationId"] = json!(Uuid::from_u128(9));
    assert_eq!(
        serde_json::to_value(ToolOutcomeDiagnostic::try_from_value(value.clone()).unwrap())
            .unwrap(),
        value
    );
    value["operationId"] = json!(Uuid::nil());
    assert!(ToolOutcomeDiagnostic::try_from_value(value).is_err());
}

#[test]
fn child_archive_intent_requires_version_operation_and_bounded_watermark_together() {
    let base = json!({"code":"CHILD_CLEANUP_UNCONFIRMED","phase":"child-cleanup",
        "safeCause":"child_archive_unconfirmed","requestId":Uuid::from_u128(1),
        "resultId":Uuid::from_u128(2),"childArchiveIntentVersion":1,
        "childArchiveOperationId":Uuid::from_u128(3),"childArchiveExpectedWatermark":0});
    let value = ToolOutcomeDiagnostic::try_from_value(base.clone()).unwrap();
    assert_eq!(serde_json::to_value(&value).unwrap(), base);
    assert_eq!(
        serde_json::from_str::<Value>(&value.to_string()).unwrap(),
        base
    );
    for key in [
        "childArchiveIntentVersion",
        "childArchiveOperationId",
        "childArchiveExpectedWatermark",
        "requestId",
        "resultId",
    ] {
        let mut partial = base.clone();
        partial.as_object_mut().unwrap().remove(key);
        assert!(ToolOutcomeDiagnostic::try_from_value(partial).is_err());
    }
    for (key, bad) in [
        ("childArchiveIntentVersion", json!(2)),
        ("childArchiveOperationId", json!(Uuid::nil())),
        (
            "childArchiveExpectedWatermark",
            json!(9_007_199_254_740_992u64),
        ),
    ] {
        let mut invalid = base.clone();
        invalid[key] = bad;
        assert!(ToolOutcomeDiagnostic::try_from_value(invalid).is_err());
    }
}

#[test]
fn child_tracking_preserves_separate_parent_and_child_identity() {
    let value = json!({"code":"CHILD_TRACKING_UNCONFIRMED","phase":"child-tracking",
        "safeCause":"child_cancellation_unconfirmed","conversationId":Uuid::from_u128(1),
        "turnId":Uuid::from_u128(2),"contextSnapshotId":Uuid::from_u128(3),
        "requestId":Uuid::from_u128(4),"childConversationId":Uuid::from_u128(5),
        "childTurnId":Uuid::from_u128(6),"childContextSnapshotId":Uuid::from_u128(7)});
    let decoded = ToolOutcomeDiagnostic::try_from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&decoded).unwrap(), value);
    assert_eq!(
        serde_json::from_str::<Value>(&decoded.to_string()).unwrap(),
        value
    );
    for key in [
        "childConversationId",
        "childTurnId",
        "childContextSnapshotId",
    ] {
        let mut invalid = value.clone();
        invalid[key] = json!(Uuid::nil());
        assert!(ToolOutcomeDiagnostic::try_from_value(invalid).is_err());
    }
}

#[test]
fn missing_fields_and_explicit_nulls_never_create_unknown_identity_facts() {
    let base = json!({"code":"TEXT_PATCH_JOURNAL_UNCONFIRMED","phase":"target-query","safeCause":"target_receipt_unavailable"});
    assert_eq!(
        serde_json::to_value(ToolOutcomeDiagnostic::try_from_value(base.clone()).unwrap()).unwrap(),
        base
    );
    let value = json!({"conversationId":null,"callId":null,"sqliteCode":null,"sqliteExtendedCode":null,
        "code":"TEXT_PATCH_JOURNAL_UNCONFIRMED","phase":"target-query","safeCause":"target_receipt_unavailable"});
    assert_eq!(
        serde_json::to_value(ToolOutcomeDiagnostic::try_from_value(value.clone()).unwrap())
            .unwrap(),
        value
    );
}

#[test]
fn unsafe_additional_fields_and_identifiers_cannot_enter_the_error_payload() {
    for key in [
        "raw",
        "body",
        "sql",
        "message",
        "providerResponse",
        "authorization",
        "epoch",
        "sqlFence",
        "path",
    ] {
        let mut value = diagnostic();
        value[key] = json!("private body");
        assert!(ToolOutcomeDiagnostic::try_from_value(value).is_err());
    }
    for key in [
        "code",
        "phase",
        "safeCause",
        "sqliteCode",
        "callId",
        "callRequestId",
        "targetRequestId",
        "journalRequestId",
    ] {
        for invalid in [
            "",
            "private body",
            "Authorization: Bearer secret",
            "{\"body\":\"private\"}",
            "line\nprivate",
            "中文",
        ] {
            let mut value = diagnostic();
            value[key] = json!(invalid);
            assert!(ToolOutcomeDiagnostic::try_from_value(value).is_err());
        }
    }
    for key in [
        "conversationId",
        "requestId",
        "turnId",
        "contextSnapshotId",
        "manuscriptId",
        "leaseId",
        "resultId",
    ] {
        for invalid in [json!("private body"), json!(Uuid::nil()), json!(5)] {
            let mut value = diagnostic();
            value[key] = invalid;
            assert!(ToolOutcomeDiagnostic::try_from_value(value).is_err());
        }
    }
    for invalid in [json!(-1), json!(2147483648_u64), json!(0.5), json!("1811")] {
        let mut value = diagnostic();
        value["sqliteExtendedCode"] = invalid;
        assert!(ToolOutcomeDiagnostic::try_from_value(value).is_err());
    }
}

#[test]
fn individual_and_total_byte_limits_allow_original_scoped_call_keys() {
    let key = format!("{}:{}:file:127", Uuid::from_u128(2), "c".repeat(512));
    let mut value = diagnostic();
    value["targetRequestId"] = json!(key);
    assert!(ToolOutcomeDiagnostic::try_from_value(value).is_ok());
    for key in [
        "callId",
        "callRequestId",
        "targetRequestId",
        "journalRequestId",
    ] {
        let mut value = diagnostic();
        value[key] = json!("a".repeat(1025));
        assert!(ToolOutcomeDiagnostic::try_from_value(value).is_err());
    }
    for key in ["code", "phase", "safeCause", "sqliteCode"] {
        let mut value = diagnostic();
        value[key] = json!("a".repeat(102));
        assert!(ToolOutcomeDiagnostic::try_from_value(value).is_err());
    }
    let mut value = diagnostic();
    for key in [
        "callId",
        "callRequestId",
        "targetRequestId",
        "journalRequestId",
    ] {
        value[key] = json!("a".repeat(1024));
    }
    assert!(serde_json::to_vec(&value).unwrap().len() < MAX_BYTES);
    assert!(ToolOutcomeDiagnostic::try_from_value(value).is_ok());
    // Whitespace input is rejected as an identifier, even when its JSON form
    // would otherwise expand beyond the total budget.
    let mut value = diagnostic();
    value["callId"] = json!("\0".repeat(1024));
    assert!(ToolOutcomeDiagnostic::try_from_value(value).is_err());
}

fn longest_required_fields() -> Value {
    json!({"code":"c".repeat(101),"phase":"p".repeat(101),"safeCause":"s".repeat(101),
        "conversationId":Uuid::from_u128(1),"requestId":Uuid::from_u128(2),"turnId":Uuid::from_u128(3),
        "contextSnapshotId":Uuid::from_u128(4),"manuscriptId":Uuid::from_u128(5),
        "leaseId":Uuid::from_u128(6),"resultId":Uuid::from_u128(7),
        "sqliteCode":"q".repeat(101),"sqliteExtendedCode":i32::MAX})
}

#[test]
fn display_keeps_every_required_fact_and_marks_whole_identifiers_omitted() {
    let required = longest_required_fields();
    let mut full = required.clone();
    for key in OPAQUE_IDENTIFIERS {
        full[key] = json!("a".repeat(1024));
    }
    let diagnostic = ToolOutcomeDiagnostic::try_from_value(full.clone()).unwrap();
    assert_eq!(serde_json::to_value(&diagnostic).unwrap(), full);
    let displayed = diagnostic.to_string();
    assert!(displayed.len() <= DISPLAY_BYTES);
    let summary: Value = serde_json::from_str(&displayed).unwrap();
    for (key, original) in required.as_object().unwrap() {
        assert_eq!(&summary[key], original);
    }
    assert_eq!(summary["identifiersOmitted"], true);
    for key in OPAQUE_IDENTIFIERS {
        assert!(summary.get(key).is_none());
    }
    assert_eq!(
        summary.as_object().unwrap().len(),
        required.as_object().unwrap().len() + 1
    );
}

#[test]
fn display_reserves_the_marker_and_prioritizes_original_whole_call_identity() {
    let mut full = longest_required_fields();
    for key in OPAQUE_IDENTIFIERS {
        full[key] = json!(format!("{key}{}", "a".repeat(60)));
    }
    let diagnostic = ToolOutcomeDiagnostic::try_from_value(full.clone()).unwrap();
    let summary: Value = serde_json::from_str(&diagnostic.to_string()).unwrap();
    assert_eq!(summary["callId"], full["callId"]);
    assert_eq!(summary["identifiersOmitted"], true);
    for key in &OPAQUE_IDENTIFIERS[1..] {
        assert!(summary.get(*key).is_none());
    }
    assert_eq!(serde_json::to_value(diagnostic).unwrap(), full);
}
