use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::{Value, json};

fn rename() -> AttachmentPrepareInputV1 {
    AttachmentPrepareInputV1::Rename {
        request: RenameAttachmentInputV1 {
            item_id: " item\0 ".into(),
            attachment_id: " attachment ".into(),
            display_name: "\n 名称.pdf \t".into(),
        },
    }
}

#[test]
fn original_public_output_order_and_explicit_nullable_fields_are_preserved() {
    assert_eq!(
        serde_json::to_string(&ReadingPosition {
            page_index: -1,
            zoom: 1.25,
            view_state_json: None,
        })
        .unwrap(),
        r#"{"pageIndex":-1,"zoom":1.25,"viewStateJson":null}"#
    );
    assert_eq!(
        serde_json::to_string(&AttachmentRemovalResult {
            file_status: "retained",
            warning: None,
        })
        .unwrap(),
        r#"{"fileStatus":"retained","warning":null}"#
    );
    let raw = " \n{\"extra\":true} ";
    let value = serde_json::to_value(ReadingPosition {
        page_index: i32::MAX,
        zoom: 0.5,
        view_state_json: Some(raw.into()),
    })
    .unwrap();
    assert_eq!(
        value,
        json!({"pageIndex":i32::MAX,"zoom":0.5,"viewStateJson":raw})
    );
    assert_eq!(
        serde_json::to_value(AttachmentRemovalResult {
            file_status: "cleanup_failed",
            warning: Some("original warning".into()),
        })
        .unwrap(),
        json!({"fileStatus":"cleanup_failed","warning":"original warning"})
    );
}

#[test]
fn original_page_text_keeps_i32_order_duplicates_unknown_fields_and_diagnostics() {
    let pages: Vec<PageText> = serde_json::from_value(json!([
        {"pageIndex":i32::MIN,"text":" raw\0 ","extra":true},
        {"pageIndex":i32::MIN,"text":"second"}
    ]))
    .unwrap();
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].page_index, i32::MIN);
    assert_eq!(pages[0].text, " raw\0 ");
    assert_eq!(pages[1].text, "second");
    for invalid in [
        json!({"pageIndex":2147483648_i64,"text":"x"}),
        json!({"pageIndex":0}),
        json!({"pageIndex":0,"text":null}),
    ] {
        assert!(serde_json::from_value::<PageText>(invalid).is_err());
    }
    assert_eq!(
        serde_json::from_value::<PageText>(json!(false))
            .unwrap_err()
            .to_string(),
        format!(
            "invalid type: boolean {}false{}, expected struct PageText",
            char::from(96),
            char::from(96)
        )
    );
}

#[test]
fn catalog_has_only_two_preparations_with_exact_echo_and_plan_shapes() {
    let input = CatalogInput::PrepareLiteratureAttachment {
        input: Box::new(rename()),
    };
    let wire = serde_json::to_value(&input).unwrap();
    assert_eq!(
        wire,
        json!({"kind":"prepareLiteratureAttachment","input":{
            "kind":"rename","request":{"itemId":" item\0 ","attachmentId":" attachment ","displayName":"\n 名称.pdf \t"}
        }})
    );
    assert_eq!(
        input.operation(),
        CatalogOperation::PrepareLiteratureAttachment
    );
    assert_eq!(serde_json::from_value::<CatalogInput>(wire).unwrap(), input);
    let AttachmentPrepareInputV1::Rename { request } = rename() else {
        unreachable!()
    };
    let output = CatalogOutput::LiteratureAttachmentPreparation {
        outcome: Box::new(AttachmentPreparationV1::Ready {
            plan: Box::new(AttachmentPlanV1::Rename {
                request,
                display_name: "名称.pdf".into(),
            }),
        }),
    };
    let value = serde_json::to_value(&output).unwrap();
    assert_eq!(value["kind"], "literatureAttachmentPreparation");
    assert_eq!(value["outcome"]["status"], "ready");
    assert_eq!(value["outcome"]["plan"]["kind"], "rename");
    assert_eq!(value["outcome"]["plan"]["displayName"], "名称.pdf");
    assert_eq!(
        output.operation(),
        CatalogOperation::PrepareLiteratureAttachment
    );
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(value).unwrap(),
        output
    );
}

#[test]
fn private_zoom_bits_and_raw_optional_json_survive_repeated_wire_roundtrips() {
    for bits in [
        0_u64,
        0x8000_0000_0000_0000,
        0x3fef_ffff_ffff_ffff,
        0x0b77_7f24_5544_ff83,
        0x4007_ffff_ffff_ffff,
        0x7ff0_0000_0000_0000,
        0x7ff8_0000_0000_0042,
    ] {
        for raw in [None, Some("null"), Some("  {\"extra\":true} \n")] {
            let request = SaveReadingStateInputV1 {
                item_id: "i".into(),
                attachment_id: "a".into(),
                page_index: i32::MIN,
                zoom: F64BitsV1::from_f64(f64::from_bits(bits)),
                view_state_json: raw.map(str::to_owned),
            };
            let mut input = CatalogInput::PrepareLiteratureAttachment {
                input: Box::new(AttachmentPrepareInputV1::SaveReadingState {
                    request: request.clone(),
                }),
            };
            for _ in 0..4 {
                input = serde_json::from_str(&serde_json::to_string(&input).unwrap()).unwrap();
            }
            let CatalogInput::PrepareLiteratureAttachment { input } = input else {
                unreachable!()
            };
            let AttachmentPrepareInputV1::SaveReadingState { request: decoded } = *input else {
                unreachable!()
            };
            assert_eq!(decoded, request);
            assert_eq!(decoded.zoom.to_f64().to_bits(), bits);
        }
    }
}

#[test]
fn new_wire_rejects_extra_authority_unsupported_branches_and_nonstring_reasons() {
    let original = json!({"kind":"prepareLiteratureAttachment","input":rename()});
    for mutate in [
        |v: &mut Value| v["sql"] = json!("private"),
        |v: &mut Value| v["input"]["steps"] = json!([]),
        |v: &mut Value| v["input"]["request"]["path"] = json!("/private"),
        |v: &mut Value| v["input"]["kind"] = json!("attach"),
        |v: &mut Value| v["input"]["kind"] = json!("read"),
        |v: &mut Value| v["input"]["request"]["displayName"] = Value::Null,
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
    }
    let output = CatalogOutput::LiteratureAttachmentPreparation {
        outcome: Box::new(AttachmentPreparationV1::Rejected {
            input: Box::new(rename()),
            reason: AttachmentRejectionV1::InvalidAttachmentName,
        }),
    };
    let original = serde_json::to_value(&output).unwrap();
    assert_eq!(
        serde_json::from_value::<CatalogOutput>(original.clone()).unwrap(),
        output
    );
    for mutate in [
        |v: &mut Value| v["outcome"]["reason"] = json!({"invalidAttachmentName":null}),
        |v: &mut Value| v["outcome"]["reason"] = json!(["invalidAttachmentName"]),
        |v: &mut Value| v["outcome"]["reason"] = json!("unknown"),
        |v: &mut Value| v["outcome"]["sql"] = json!("private"),
        |v: &mut Value| v["outcome"]["input"]["request"]["writer"] = json!("private"),
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert!(serde_json::from_value::<CatalogOutput>(value).is_err());
    }
    assert_eq!(
        AttachmentRejectionV1::InvalidAttachmentName.code(),
        "attachment_name_invalid"
    );
    assert_eq!(
        AttachmentRejectionV1::InvalidAttachmentName.message(),
        "附件名称不能为空、超过 255 个字符或包含控制字符"
    );
    assert_eq!(
        AttachmentRejectionV1::InvalidReaderViewState.code(),
        "invalid_input"
    );
    assert_eq!(
        AttachmentRejectionV1::InvalidReaderViewState.message(),
        "阅读位置不是有效的 ReaderViewStateV2"
    );
}
