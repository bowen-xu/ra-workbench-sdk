use super::*;

fn catalog_request(operation: CatalogOperation) -> Request {
    let mut request = request(RequestBody::Initialize);
    request.body = RequestBody::Catalog {
        operation,
        snapshot: SnapshotRef::catalog_input(&request, 42, "b".repeat(64)),
    };
    request
}

fn catalog_response(request: &Request) -> Response {
    Response::for_request(
        request,
        ResponseBody::CatalogResult {
            payload: SnapshotRef::catalog_result(request, 43, "c".repeat(64)),
        },
    )
}

#[test]
fn catalog_operations_use_exact_request_and_response_shapes() {
    for (operation, name) in [
        (CatalogOperation::Plan, "plan"),
        (CatalogOperation::Select, "select"),
        (CatalogOperation::Project, "project"),
        (
            CatalogOperation::SelectUnreviewedFields,
            "selectUnreviewedFields",
        ),
        (
            CatalogOperation::ValidateEditableTemplate,
            "validateEditableTemplate",
        ),
        (CatalogOperation::PrepareTrashCleanup, "prepareTrashCleanup"),
        (
            CatalogOperation::PreparePdfImportHeader,
            "preparePdfImportHeader",
        ),
        (
            CatalogOperation::DecodePdfImportCandidate,
            "decodePdfImportCandidate",
        ),
        (
            CatalogOperation::PrepareLiteratureAttachment,
            "prepareLiteratureAttachment",
        ),
        (
            CatalogOperation::PrepareReferenceRecord,
            "prepareReferenceRecord",
        ),
        (
            CatalogOperation::PrepareDuplicateUndo,
            "prepareDuplicateUndo",
        ),
    ] {
        let request = catalog_request(operation);
        let encoded = encode_request(&request).unwrap();
        assert_eq!(encoded.last(), Some(&b'\n'));
        assert_eq!(
            decode_request(&encoded[..encoded.len() - 1]).unwrap(),
            request
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&encoded).unwrap(),
            json!({
                "protocolVersion":2,"pluginId":"literature_library","packageKey":"a".repeat(64),
                "instanceId":request.instance_id,"requestId":request.request_id,
                "body":{"kind":"catalog","operation":name,"snapshot":{
                    "relativeHandle":format!("catalog-input-{}.json",request.request_id),
                    "byteSize":42,"sha256":"b".repeat(64),"packageKey":"a".repeat(64),
                    "instanceId":request.instance_id,"requestId":request.request_id
                }}
            })
        );
        let response = catalog_response(&request);
        let encoded = encode_response(&response).unwrap();
        assert_eq!(encoded.last(), Some(&b'\n'));
        let decoded = decode_response(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decoded, response);
        decoded.validate_for_request(&request).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&encoded).unwrap(),
            json!({
                "protocolVersion":2,"pluginId":"literature_library","packageKey":"a".repeat(64),
                "instanceId":request.instance_id,"requestId":request.request_id,
                "body":{"kind":"catalogResult","payload":{
                    "relativeHandle":format!("catalog-result-{}.json",request.request_id),
                    "byteSize":43,"sha256":"c".repeat(64),"packageKey":"a".repeat(64),
                    "instanceId":request.instance_id,"requestId":request.request_id
                }}
            })
        );
    }
}

#[test]
fn catalog_wire_rejects_unknown_fields_operations_and_authority() {
    let request = catalog_request(CatalogOperation::Plan);
    let original = serde_json::to_value(&request).unwrap();
    for mutate in [
        |value: &mut Value| value["extra"] = json!(true),
        |value: &mut Value| value["body"]["sql"] = json!("private-sql"),
        |value: &mut Value| value["body"]["operation"] = json!("execute"),
        |value: &mut Value| value["body"]["operation"] = json!(null),
        |value: &mut Value| value["body"]["snapshot"]["path"] = json!("private-path"),
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert_eq!(
            decode_request(&payload(&value)),
            Err(ProtocolError::InvalidFrame)
        );
    }
    let mut value = original;
    value["body"].as_object_mut().unwrap().remove("operation");
    assert_eq!(
        decode_request(&payload(&value)),
        Err(ProtocolError::InvalidFrame)
    );

    let original = serde_json::to_value(catalog_response(&request)).unwrap();
    for mutate in [
        |value: &mut Value| value["extra"] = json!(true),
        |value: &mut Value| value["body"]["items"] = json!([]),
        |value: &mut Value| value["body"]["operation"] = json!("plan"),
        |value: &mut Value| value["body"]["payload"]["sql"] = json!("private-sql"),
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert_eq!(
            decode_response(&payload(&value)),
            Err(ProtocolError::InvalidFrame)
        );
    }
}

#[test]
fn catalog_file_references_require_the_exact_direction_and_request_filename() {
    let request = catalog_request(CatalogOperation::Select);
    let original_request = serde_json::to_value(&request).unwrap();
    let original_response = serde_json::to_value(catalog_response(&request)).unwrap();
    for handle in [
        "../catalog-input.json".to_string(),
        "/catalog-input.json".to_string(),
        "sub/catalog-input.json".to_string(),
        "catalog-input.json".to_string(),
        snapshot_handle(&request.request_id),
        catalog_input_handle("bc27daa2-3ef5-43b5-bc5b-e9ca02081b12"),
        format!("{}/extra", catalog_input_handle(&request.request_id)),
    ] {
        let mut value = original_request.clone();
        value["body"]["snapshot"]["relativeHandle"] = json!(handle);
        assert_eq!(
            decode_request(&payload(&value)),
            Err(ProtocolError::InvalidSnapshot)
        );
    }
    let mut value = original_request;
    value["body"]["snapshot"]["relativeHandle"] = json!(catalog_result_handle(&request.request_id));
    assert_eq!(
        decode_request(&payload(&value)),
        Err(ProtocolError::InvalidSnapshot)
    );
    for handle in [
        "../catalog-result.json".to_string(),
        "catalog-result.json".to_string(),
        snapshot_handle(&request.request_id),
        catalog_input_handle(&request.request_id),
        catalog_result_handle("bc27daa2-3ef5-43b5-bc5b-e9ca02081b12"),
    ] {
        let mut value = original_response.clone();
        value["body"]["payload"]["relativeHandle"] = json!(handle);
        assert_eq!(
            decode_response(&payload(&value)),
            Err(ProtocolError::InvalidSnapshot)
        );
    }
}

#[test]
fn catalog_reference_rejects_invalid_hash_size_and_embedded_identity() {
    let request = catalog_request(CatalogOperation::Project);
    let originals = [
        (serde_json::to_value(&request).unwrap(), "snapshot", false),
        (
            serde_json::to_value(catalog_response(&request)).unwrap(),
            "payload",
            true,
        ),
    ];
    for (original, key, is_response) in originals {
        for (field, invalid) in [
            ("byteSize", json!(0)),
            ("sha256", json!("")),
            ("sha256", json!("b".repeat(63))),
            ("sha256", json!("b".repeat(65))),
            ("sha256", json!("B".repeat(64))),
            ("sha256", json!("g".repeat(64))),
            ("packageKey", json!("d".repeat(64))),
            ("instanceId", json!("bc27daa2-3ef5-43b5-bc5b-e9ca02081b12")),
            ("requestId", json!("bc27daa2-3ef5-43b5-bc5b-e9ca02081b12")),
        ] {
            let mut value = original.clone();
            value["body"][key][field] = invalid;
            let error = if is_response {
                decode_response(&payload(&value)).unwrap_err()
            } else {
                decode_request(&payload(&value)).unwrap_err()
            };
            assert_eq!(error, ProtocolError::InvalidSnapshot);
        }
        for invalid in [json!(-1), json!(1.5), json!("42"), json!(null)] {
            let mut value = original.clone();
            value["body"][key]["byteSize"] = invalid;
            let error = if is_response {
                decode_response(&payload(&value)).unwrap_err()
            } else {
                decode_request(&payload(&value)).unwrap_err()
            };
            assert_eq!(error, ProtocolError::InvalidFrame);
        }
        let mut value = original;
        value["body"][key]["byteSize"] = json!(u64::MAX);
        if is_response {
            decode_response(&payload(&value)).unwrap();
        } else {
            decode_request(&payload(&value)).unwrap();
        }
    }
}

#[test]
fn catalog_replies_require_matching_identity_and_cannot_replace_trace_replies() {
    let request = catalog_request(CatalogOperation::Plan);
    let original = catalog_response(&request);
    for field in ["packageKey", "instanceId", "requestId"] {
        let mut value = serde_json::to_value(&original).unwrap();
        value[field] = if field == "packageKey" {
            json!("d".repeat(64))
        } else {
            json!("bc27daa2-3ef5-43b5-bc5b-e9ca02081b12")
        };
        value["body"]["payload"][field] = value[field].clone();
        if field == "requestId" {
            value["body"]["payload"]["relativeHandle"] =
                json!(catalog_result_handle(value[field].as_str().unwrap()));
        }
        let response = decode_response(&payload(&value)).unwrap();
        assert_eq!(
            response.validate_for_request(&request),
            Err(ProtocolError::ResponseMismatch)
        );
    }
    let trace = decide_request();
    let response = Response::for_request(
        &request,
        ResponseBody::NoteTraceDecision {
            decision: TraceDecision::Rejected {
                reason: TraceRejection::NotFound,
            },
        },
    );
    assert_eq!(
        response.validate_for_request(&request),
        Err(ProtocolError::ResponseMismatch)
    );
    assert_eq!(
        original.validate_for_request(&trace),
        Err(ProtocolError::ResponseMismatch)
    );
}

#[test]
fn adding_catalog_preserves_the_original_trace_request_bytes() {
    let request = decide_request();
    let expected = concat!(
        "{\"protocolVersion\":2,\"pluginId\":\"literature_library\",\"packageKey\":\"",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "\",\"instanceId\":\"8cbfd428-3ac1-4bce-b4f6-d41f31063d8e\",",
        "\"requestId\":\"590c18c0-52f2-4905-8e39-23e082778384\",",
        "\"body\":{\"kind\":\"decideNoteTrace\",\"snapshot\":{",
        "\"relativeHandle\":\"note-trace-590c18c0-52f2-4905-8e39-23e082778384.json\",",
        "\"byteSize\":42,\"sha256\":\"",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "\",\"packageKey\":\"",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "\",\"instanceId\":\"8cbfd428-3ac1-4bce-b4f6-d41f31063d8e\",",
        "\"requestId\":\"590c18c0-52f2-4905-8e39-23e082778384\"}}}\n"
    );
    assert_eq!(encode_request(&request).unwrap(), expected.as_bytes());
    assert_eq!(
        decode_request(&expected.as_bytes()[..expected.len() - 1]).unwrap(),
        request
    );
}

#[test]
fn duplicate_merge_preparation_uses_the_original_catalog_identity_contract() {
    let request = catalog_request(CatalogOperation::PrepareDuplicateMerge);
    let encoded = encode_request(&request).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&encoded).unwrap()["body"]["operation"],
        "prepareDuplicateMerge"
    );
    assert_eq!(
        decode_request(&encoded[..encoded.len() - 1]).unwrap(),
        request
    );
    let response = catalog_response(&request);
    let encoded = encode_response(&response).unwrap();
    let decoded = decode_response(&encoded[..encoded.len() - 1]).unwrap();
    assert_eq!(decoded, response);
    decoded.validate_for_request(&request).unwrap();
    let mut wrong = response;
    wrong.request_id = "bc27daa2-3ef5-43b5-bc5b-e9ca02081b12".into();
    let ResponseBody::CatalogResult { payload } = &mut wrong.body else {
        unreachable!()
    };
    payload.request_id.clone_from(&wrong.request_id);
    payload.relative_handle = catalog_result_handle(&wrong.request_id);
    assert_eq!(
        wrong.validate_for_request(&request),
        Err(ProtocolError::ResponseMismatch)
    );
}

#[test]
fn literature_lifecycle_preparation_uses_the_existing_v2_catalog_identity_contract() {
    let request = catalog_request(CatalogOperation::PrepareLiteratureLifecycle);
    let encoded = encode_request(&request).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&encoded).unwrap()["body"]["operation"],
        "prepareLiteratureLifecycle"
    );
    assert_eq!(
        decode_request(&encoded[..encoded.len() - 1]).unwrap(),
        request
    );
    let response = catalog_response(&request);
    let encoded = encode_response(&response).unwrap();
    let decoded = decode_response(&encoded[..encoded.len() - 1]).unwrap();
    assert_eq!(decoded, response);
    decoded.validate_for_request(&request).unwrap();
    let mut wrong = response;
    wrong.request_id = "bc27daa2-3ef5-43b5-bc5b-e9ca02081b12".into();
    let ResponseBody::CatalogResult { payload: reference } = &mut wrong.body else {
        unreachable!()
    };
    reference.request_id.clone_from(&wrong.request_id);
    reference.relative_handle = catalog_result_handle(&wrong.request_id);
    assert_eq!(
        wrong.validate_for_request(&request),
        Err(ProtocolError::ResponseMismatch)
    );
    let mut wrong_kind = serde_json::to_value(&request).unwrap();
    wrong_kind["body"]["operation"] = json!("executeLifecycleSql");
    assert_eq!(
        decode_request(&payload(&wrong_kind)),
        Err(ProtocolError::InvalidFrame)
    );
}
