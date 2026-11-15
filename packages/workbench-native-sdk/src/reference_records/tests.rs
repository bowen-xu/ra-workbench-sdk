use super::*;
use serde_json::{Value, json};

mod wire;

fn draft() -> ReferenceRecordDraft {
    serde_json::from_value(json!({
        "id":null,"citingPaperId":" paper\u{0000} ","sourceAnchorId":" source ",
        "rawText":"  引用  ","fields":[{"name":"title","value":" 原值 ",
            "sourceKind":"human","confirmedByUser":true}],
        "parseState":"parsed","identityState":"unverified","matchedItemId":null,
        "semanticState":"unreviewed","usageKind":null,"usageSummary":"",
        "usageAnchorId":null,"expectedRevision":i64::MIN,"changeReason":" reason "
    }))
    .unwrap()
}

#[test]
fn original_draft_json_order_nulls_and_full_i64_are_preserved() {
    let draft = draft();
    assert_eq!(
        serde_json::to_string(&draft).unwrap(),
        concat!(
            r#"{"id":null,"citingPaperId":" paper\u0000 ","sourceAnchorId":" source ","#,
            r#""rawText":"  引用  ","fields":[{"name":"title","value":" 原值 ","#,
            r#""sourceKind":"human","confirmedByUser":true}],"parseState":"parsed","#,
            r#""identityState":"unverified","matchedItemId":null,"semanticState":"unreviewed","#,
            r#""usageKind":null,"usageSummary":"","usageAnchorId":null,"#,
            r#""expectedRevision":-9223372036854775808,"changeReason":" reason "}"#
        )
    );
    let mut value = serde_json::to_value(&draft).unwrap();
    let object = value.as_object_mut().unwrap();
    object.remove("fields");
    object.remove("usageSummary");
    object.remove("id");
    object.insert("futureField".into(), json!(true));
    let decoded: ReferenceRecordDraft = serde_json::from_value(value.clone()).unwrap();
    assert!(decoded.id.is_none());
    assert!(decoded.fields.is_empty());
    assert!(decoded.usage_summary.is_empty());
    value["fields"] = Value::Null;
    assert!(serde_json::from_value::<ReferenceRecordDraft>(value).is_err());
}

#[test]
fn original_record_only_skips_the_three_nullable_output_fields() {
    let value = json!({
        "id":"r","citingPaperId":"p","sourceAnchorId":"a","rawText":"raw",
        "fields":[],"parseState":"future","identityState":"future",
        "matchedItemId":null,"semanticState":"future","usageKind":null,
        "usageSummary":" ","usageAnchorId":null,"provenanceKind":"future",
        "revision":i64::MAX,"createdAt":"created","updatedAt":"updated","ignored":1
    });
    let record: ReferenceRecord = serde_json::from_value(value).unwrap();
    let mut expected = json!({
        "id":"r","citingPaperId":"p","sourceAnchorId":"a","rawText":"raw",
        "fields":[],"parseState":"future","identityState":"future",
        "semanticState":"future","usageSummary":" ","provenanceKind":"future",
        "revision":i64::MAX,"createdAt":"created","updatedAt":"updated"
    });
    assert_eq!(serde_json::to_value(&record).unwrap(), expected);
    for key in ["matchedItemId", "usageKind", "usageAnchorId"] {
        expected[key] = json!("");
    }
    let record: ReferenceRecord = serde_json::from_value(expected.clone()).unwrap();
    assert_eq!(serde_json::to_value(record).unwrap(), expected);
}

#[test]
fn original_struct_names_and_required_field_diagnostics_are_unchanged() {
    for (actual, name) in [
        (
            serde_json::from_value::<ReferenceMetadataField>(json!(false)).unwrap_err(),
            "ReferenceMetadataField",
        ),
        (
            serde_json::from_value::<ReferenceRecordDraft>(json!(false)).unwrap_err(),
            "ReferenceRecordDraft",
        ),
        (
            serde_json::from_value::<ReferenceRecord>(json!(false)).unwrap_err(),
            "ReferenceRecord",
        ),
    ] {
        assert_eq!(
            actual.to_string(),
            format!(
                "invalid type: boolean {}false{}, expected struct {name}",
                char::from(96),
                char::from(96)
            )
        );
    }
    assert_eq!(
        serde_json::from_value::<ReferenceMetadataField>(json!({
            "name":"title","value":"v","sourceKind":"human"
        }))
        .unwrap_err()
        .to_string(),
        format!(
            "missing field {}confirmedByUser{}",
            char::from(96),
            char::from(96)
        )
    );
}

#[test]
fn stored_field_codec_is_structural_and_does_not_run_write_policy() {
    let raw = json!([{
        "name":"unknown","value":"x".repeat(2001),"sourceKind":"unknown",
        "confirmedByUser":true,"futureField":null
    },{
        "name":"unknown","value":"duplicate","sourceKind":"ai_inference",
        "confirmedByUser":true
    }])
    .to_string();
    let fields: Vec<ReferenceMetadataField> = serde_json::from_str(&raw).unwrap();
    assert_eq!(fields.len(), 2);
    assert_eq!(fields[0].name, "unknown");
    assert_eq!(fields[0].value.len(), 2001);
    assert_eq!(fields[1].source_kind, "ai_inference");
    assert!(serde_json::from_str::<Vec<ReferenceMetadataField>>("null").is_err());
}

#[test]
fn original_rejection_messages_are_safe_and_exact() {
    use ReferenceRecordRejectionV1::*;
    for (reason, expected) in [
        (InvalidFields, "参考条目字段无效"),
        (InvalidStates, "参考条目状态组合无效"),
        (InvalidMetadataFields, "参考条目解析字段或来源无效"),
        (AnchorOwnership, "参考条目来源必须属于当前文献"),
        (MatchedItemMissing, "匹配的文献对象不存在"),
        (NewExpectedRevision, "新参考条目不能携带预期版本"),
        (ImmutableOwner, "参考条目不能改写所属文献或原始来源"),
        (FieldsEncoding, "参考字段无法序列化"),
        (SnapshotEncoding, "参考条目版本无法序列化"),
        (StoredFieldsEncoding, "参考字段存储格式无效"),
    ] {
        assert_eq!(reason.message(), expected);
    }
}
