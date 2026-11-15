use super::*;
use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
use serde_json::{Value, json};

fn candidate() -> PdfImportCandidate {
    serde_json::from_value(json!({
        "path":"relative/论文.pdf",
        "draft":{"id":"original-id","itemType":"document","title":"  Original  ",
            "rawBibtex":"unchanged\u{0}bibtex","sourceKind":"custom"}
    }))
    .unwrap()
}

#[test]
fn original_candidate_keeps_field_order_defaults_null_and_unknown_tolerance() {
    let value: PdfImportCandidate = serde_json::from_value(json!({
        "path":"sample.pdf","ignored":true,
        "draft":{"itemType":"document","title":"Title","ignored":"future"}
    }))
    .unwrap();
    assert_eq!(value.path, "sample.pdf");
    assert_eq!(value.draft.id, None);
    assert_eq!(value.draft.creators, []);
    assert_eq!(value.draft.tags, Vec::<String>::new());
    assert_eq!(
        serde_json::to_string(&value).unwrap(),
        concat!(
            "{\"path\":\"sample.pdf\",\"draft\":{\"id\":null,\"itemType\":\"document\",",
            "\"title\":\"Title\",\"abstractText\":\"\",\"issuedYear\":null,",
            "\"containerTitle\":\"\",\"conferenceName\":\"\",\"proceedingsTitle\":\"\",",
            "\"place\":\"\",\"volume\":\"\",\"issue\":\"\",\"pages\":\"\",\"doi\":\"\",",
            "\"url\":\"\",\"language\":\"\",\"bibtexKey\":\"\",\"rawBibtex\":null,",
            "\"creators\":[],\"tags\":[],\"sourceKind\":null}}"
        )
    );
}

#[test]
fn original_candidate_retains_rust_name_sequence_and_required_field_errors() {
    for (raw, expected) in [
        (
            "7",
            "invalid type: integer `7`, expected struct PdfImportCandidate at line 1 column 1",
        ),
        (
            "[]",
            "invalid length 0, expected struct PdfImportCandidate with 2 elements at line 1 column 2",
        ),
        (
            r#"{"path":"sample.pdf"}"#,
            "missing field `draft` at line 1 column 21",
        ),
    ] {
        assert_eq!(
            serde_json::from_str::<PdfImportCandidate>(raw)
                .unwrap_err()
                .to_string(),
            expected
        );
    }
    let value = candidate();
    let sequence = json!([value.path, value.draft]);
    assert_eq!(
        serde_json::from_value::<PdfImportCandidate>(sequence).unwrap(),
        value
    );
}

#[test]
fn both_catalog_calls_and_outputs_have_exact_operation_and_shape() {
    let candidate = candidate();
    let raw = serde_json::to_string(&candidate).unwrap();
    let entry = PreparedPdfImportEntryV1 {
        candidate: candidate.clone(),
        input_label: candidate.path.clone(),
        raw_input: raw.clone(),
    };
    let calls = [
        (
            CatalogInput::PreparePdfImportHeader {
                candidates: vec![candidate.clone()],
            },
            CatalogOutput::PdfImportHeaderPreparation {
                outcome: Box::new(PdfImportHeaderPreparationV1::Ready {
                    entries: vec![entry.clone()],
                }),
            },
            CatalogOperation::PreparePdfImportHeader,
            json!({"kind":"preparePdfImportHeader","candidates":[candidate.clone()]}),
            json!({"kind":"pdfImportHeaderPreparation","outcome":{"status":"ready","entries":[entry]}}),
        ),
        (
            CatalogInput::DecodePdfImportCandidate {
                raw_input: raw.clone(),
            },
            CatalogOutput::PdfImportCandidateDecoded {
                outcome: Box::new(DecodedPdfImportCandidateV1 {
                    raw_input: raw.clone(),
                    candidate: candidate.clone(),
                }),
            },
            CatalogOperation::DecodePdfImportCandidate,
            json!({"kind":"decodePdfImportCandidate","rawInput":raw.clone()}),
            json!({"kind":"pdfImportCandidateDecoded","outcome":{"rawInput":raw,"candidate":candidate}}),
        ),
    ];
    for (input, output, operation, expected_input, expected_output) in calls {
        assert_eq!(input.operation(), operation);
        assert_eq!(output.operation(), operation);
        assert_eq!(serde_json::to_value(&input).unwrap(), expected_input);
        assert_eq!(serde_json::to_value(&output).unwrap(), expected_output);
        assert_eq!(
            serde_json::from_value::<CatalogInput>(expected_input).unwrap(),
            input
        );
        assert_eq!(
            serde_json::from_value::<CatalogOutput>(expected_output).unwrap(),
            output
        );
    }
}

#[test]
fn new_containers_reject_unknown_authority_but_do_not_tighten_candidate_codec() {
    for value in [
        json!({"kind":"preparePdfImportHeader","candidates":[],"sql":"forbidden"}),
        json!({"kind":"decodePdfImportCandidate","rawInput":"sample.pdf","path":"forbidden"}),
    ] {
        assert!(serde_json::from_value::<CatalogInput>(value).is_err());
    }
    let input = json!({"kind":"preparePdfImportHeader","candidates":[{
        "path":"sample.pdf","extra":true,"draft":{"itemType":"document","title":"A"}
    }]});
    assert!(serde_json::from_value::<CatalogInput>(input).is_ok());
    for value in [
        json!({"status":"ready","entries":[],"steps":[]}),
        json!({"status":"rejected","candidates":[],"reason":"other"}),
        json!({"status":"rejected","candidates":[],"reason":{"noFilesSelected":null}}),
    ] {
        assert!(serde_json::from_value::<PdfImportHeaderPreparationV1>(value).is_err());
    }
    let mut value = serde_json::to_value(DecodedPdfImportCandidateV1 {
        raw_input: "sample.pdf".to_owned(),
        candidate: candidate(),
    })
    .unwrap();
    value["sql"] = Value::Bool(true);
    assert!(serde_json::from_value::<DecodedPdfImportCandidateV1>(value).is_err());
}

#[test]
fn empty_rejection_preserves_original_command_code_and_message() {
    let value = PdfImportHeaderPreparationV1::Rejected {
        candidates: vec![],
        reason: PdfImportRejectionV1::NoFilesSelected,
    };
    let encoded = json!({"status":"rejected","candidates":[],"reason":"noFilesSelected"});
    assert_eq!(serde_json::to_value(&value).unwrap(), encoded);
    assert_eq!(
        serde_json::from_value::<PdfImportHeaderPreparationV1>(encoded).unwrap(),
        value
    );
    assert_eq!(
        PdfImportRejectionV1::NoFilesSelected.code(),
        "invalid_input"
    );
    assert_eq!(
        PdfImportRejectionV1::NoFilesSelected.detail(),
        "没有选择 PDF 文件"
    );
    assert_eq!(
        PdfImportRejectionV1::NoFilesSelected.message(),
        "不是有效的 PDF 文件：没有选择 PDF 文件"
    );
}
