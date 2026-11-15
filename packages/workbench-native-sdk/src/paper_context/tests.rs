use super::*;
use serde_json::json;

#[test]
fn original_context_leaf_keeps_camel_case_optional_omissions_and_tolerant_extra_fields() {
    let value = json!({
        "id": "P1-T1", "paperId": "paper", "attachmentId": "attachment",
        "contentSha256": "sha", "parseRunId": "run", "rawRef": "#/texts/0",
        "kind": "text", "regions": [], "futureLegacyField": true
    });
    let item: PaperAiReadingContextItem = serde_json::from_value(value).unwrap();
    assert_eq!(item.page_index, None);
    assert_eq!(
        serde_json::to_value(&item).unwrap(),
        json!({
            "id": "P1-T1", "paperId": "paper", "attachmentId": "attachment",
            "contentSha256": "sha", "parseRunId": "run", "rawRef": "#/texts/0",
            "kind": "text", "regions": []
        })
    );
    let status: PaperAiReadingAttachmentStatus = serde_json::from_value(json!({
        "attachmentId": "a", "displayName": "论文.pdf", "contentSha256": "sha",
        "parseStatus": "missing", "futureLegacyField": null
    }))
    .unwrap();
    assert_eq!(status.parse_run_id, None);
    assert!(
        serde_json::to_value(status)
            .unwrap()
            .get("parseRunId")
            .is_none()
    );
}

#[test]
fn original_snapshot_leaf_retains_explicit_nulls_and_fractional_region_values() {
    let item = PaperContextItem {
        id: "item".into(),
        attachment_id: "a".into(),
        content_sha256: "sha".into(),
        parse_run_id: "run".into(),
        raw_ref: "#/texts/0".into(),
        kind: "text".into(),
        label: None,
        page_index: None,
        regions: vec![PaperAiReadingRegion {
            page_index: 1,
            rect: PaperAiReadingRect {
                x: 0.014283342571969617,
                y: 0.0,
                width: 0.5,
                height: 0.25,
            },
        }],
        charspan: None,
        source_text_hash: None,
        text: None,
        table_json: None,
        image_content_sha256: None,
    };
    let value = serde_json::to_value(&item).unwrap();
    for key in [
        "label",
        "pageIndex",
        "charspan",
        "sourceTextHash",
        "text",
        "tableJson",
        "imageContentSha256",
    ] {
        assert_eq!(value.get(key), Some(&serde_json::Value::Null));
    }
    let restored: PaperContextItem = serde_json::from_value(value).unwrap();
    assert_eq!(restored, item);
}

#[test]
fn finite_input_preserves_attachment_order_duplicate_parse_json_and_exact_field_set() {
    let attachment = ContextAttachmentV1 {
        id: "a".into(),
        display_name: "论文.pdf".into(),
        content_sha256: "sha".into(),
        parse: Some(ContextParseRunV1 {
            id: "parse".into(),
            json_content: json!({"texts": ["α"]}),
        }),
        has_stale_parse: true,
    };
    let input = PaperContextBuildInputV1 {
        paper_id: "paper".into(),
        attachments: vec![attachment.clone(), attachment],
    };
    let serialized = serde_json::to_string(&input).unwrap();
    assert_eq!(
        serde_json::from_str::<PaperContextBuildInputV1>(&serialized).unwrap(),
        input
    );
    let mut unknown = serde_json::to_value(input).unwrap();
    unknown["database"] = json!("not permitted");
    assert!(serde_json::from_value::<PaperContextBuildInputV1>(unknown).is_err());
}

#[test]
fn binary_table_option_keeps_present_null_while_human_json_bytes_stay_original() {
    use crate::paper_context_wire::{decode_payload, encode_payload};
    let mut reading: PaperAiReadingContextItem = serde_json::from_value(json!({
        "id":"P1-TABLE1","paperId":"paper","attachmentId":"a","contentSha256":"sha",
        "parseRunId":"run","rawRef":"#/tables/0","kind":"table","regions":[]
    }))
    .unwrap();
    let absent_json = r##"{"id":"P1-TABLE1","paperId":"paper","attachmentId":"a","contentSha256":"sha","parseRunId":"run","rawRef":"#/tables/0","kind":"table","regions":[]}"##;
    assert_eq!(serde_json::to_string(&reading).unwrap(), absent_json);
    reading.table_json = Some(Value::Null);
    assert_eq!(
        serde_json::to_string(&reading).unwrap(),
        absent_json.replace("\"regions\":[]}", "\"regions\":[],\"tableJson\":null}")
    );
    let mut snapshot = PaperContextItem {
        id: reading.id.clone(),
        attachment_id: "a".into(),
        content_sha256: "sha".into(),
        parse_run_id: "run".into(),
        raw_ref: "#/tables/0".into(),
        kind: "table".into(),
        label: None,
        page_index: None,
        regions: vec![],
        charspan: None,
        source_text_hash: None,
        text: None,
        table_json: None,
        image_content_sha256: None,
    };
    let snapshot_json = r##"{"id":"P1-TABLE1","attachmentId":"a","contentSha256":"sha","parseRunId":"run","rawRef":"#/tables/0","kind":"table","label":null,"pageIndex":null,"regions":[],"charspan":null,"sourceTextHash":null,"text":null,"tableJson":null,"imageContentSha256":null}"##;
    for value in [
        None,
        Some(Value::Null),
        Some(json!({"a": [null, -0.0, u64::MAX]})),
    ] {
        reading.table_json = value.clone();
        snapshot.table_json = value.clone();
        let reading_back: PaperAiReadingContextItem =
            decode_payload(&encode_payload(&reading).unwrap()).unwrap();
        let snapshot_back: PaperContextItem =
            decode_payload(&encode_payload(&snapshot).unwrap()).unwrap();
        assert_eq!(reading_back.table_json, value);
        assert_eq!(snapshot_back.table_json, value);
        // This is the original nullable SQL column projection, not a new codec.
        assert_eq!(
            snapshot_back.table_json.as_ref().map(Value::to_string),
            value.as_ref().map(Value::to_string)
        );
        if value.is_none() || value == Some(Value::Null) {
            assert_eq!(serde_json::to_string(&snapshot).unwrap(), snapshot_json);
        }
    }
    // JSON null and a missing field retain the old human-readable decoder.
    let mut human: Value = serde_json::from_str(snapshot_json).unwrap();
    assert!(
        serde_json::from_value::<PaperContextItem>(human.clone())
            .unwrap()
            .table_json
            .is_none()
    );
    human.as_object_mut().unwrap().remove("tableJson");
    assert!(
        serde_json::from_value::<PaperContextItem>(human)
            .unwrap()
            .table_json
            .is_none()
    );
}
