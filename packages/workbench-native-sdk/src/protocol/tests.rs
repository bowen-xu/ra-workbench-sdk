use super::*;
use research_agent_api::mcp::FrameDecoder;
use serde_json::json;

fn request(body: RequestBody) -> Request {
    Request {
        protocol_version: PROTOCOL_VERSION,
        plugin_id: PLUGIN_ID.into(),
        package_key: "ab".repeat(32),
        instance_id: "10000000-0000-4000-8000-000000000001".into(),
        request_id: "20000000-0000-4000-8000-000000000002".into(),
        body,
    }
}

fn result(preview: ImportPreview) -> ResponseBody {
    ResponseBody::PreviewImportResult {
        outcome: PreviewOutcome::Success { preview },
    }
}

#[test]
fn v1_canonical_frames_keep_exact_json_bytes_and_original_codec_errors() {
    let request = request(RequestBody::Initialize);
    let expected = format!(
        "{{\"protocolVersion\":1,\"pluginId\":\"writing_projects\",\"packageKey\":\"{}\",\"instanceId\":\"10000000-0000-4000-8000-000000000001\",\"requestId\":\"20000000-0000-4000-8000-000000000002\",\"body\":{{\"kind\":\"initialize\"}}}}\n",
        "ab".repeat(32)
    );
    assert_eq!(encode_request(&request).unwrap(), expected.as_bytes());
    assert_eq!(
        decode_request(expected.trim_end().as_bytes()),
        Ok(request.clone())
    );

    let response = Response::for_request(
        &request,
        ResponseBody::Initialized {
            capability: CAPABILITY_ID.into(),
            version: 1,
        },
    );
    let expected_response = expected.replace(
        "\"kind\":\"initialize\"",
        "\"kind\":\"initialized\",\"capability\":\"writing.import-preview\",\"version\":1",
    );
    assert_eq!(
        encode_response(&response).unwrap(),
        expected_response.as_bytes()
    );
    assert_eq!(
        decode_response(expected_response.trim_end().as_bytes()),
        Ok(response)
    );
    assert_eq!(decode_request(b""), Err(ProtocolError::FrameBudget));
    assert_eq!(
        decode_request(expected.as_bytes()),
        Err(ProtocolError::InvalidFrame)
    );
    assert_eq!(decode_request(b"{}\r"), Err(ProtocolError::InvalidFrame));
}

#[test]
fn wire_shape_is_camel_case_and_replies_match_complete_identity_and_kind() {
    let request = request(RequestBody::PreviewImport {
        source_path: "/tmp/source.zip".into(),
    });
    let wire = encode_request(&request).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&wire).unwrap();
    assert_eq!(
        value["body"],
        json!({"kind":"previewImport","sourcePath":"/tmp/source.zip"})
    );
    assert_eq!(value["protocolVersion"], 1);
    let mut decoder = FrameDecoder::with_max_frame_bytes(MAX_FRAME_BYTES);
    let frames = decoder.push(&wire).unwrap();
    assert_eq!(decode_request(&frames[0]).unwrap(), request);
    let response = Response::for_request(
        &request,
        result(ImportPreview {
            file_count: 2,
            byte_size: 41,
            root_candidates: vec!["main.tex".into()],
        }),
    );
    assert_eq!(response.validate_for_request(&request), Ok(()));
    let wire = encode_response(&response).unwrap();
    assert_eq!(decode_response(&wire[..wire.len() - 1]).unwrap(), response);
    for field in ["packageKey", "instanceId", "requestId"] {
        let mut other = serde_json::to_value(&response).unwrap();
        other[field] = if field == "packageKey" {
            json!("cd".repeat(32))
        } else {
            json!("30000000-0000-4000-8000-000000000003")
        };
        let other: Response = serde_json::from_value(other).unwrap();
        assert_eq!(
            other.validate_for_request(&request),
            Err(ProtocolError::ResponseMismatch)
        );
    }
    let wrong = Response::for_request(&request, ResponseBody::ShutdownComplete);
    assert_eq!(
        wrong.validate_for_request(&request),
        Err(ProtocolError::ResponseMismatch)
    );
}

#[test]
fn rejects_unknown_methods_fields_versions_and_noncanonical_identities() {
    let request = request(RequestBody::Initialize);
    let original = serde_json::to_value(&request).unwrap();
    for (field, value) in [
        ("protocolVersion", json!(2)),
        ("pluginId", json!("literature_library")),
        ("packageKey", json!("AB".repeat(32))),
        ("packageKey", json!("a".repeat(63))),
        ("instanceId", json!("10000000000040008000000000000001")),
        ("requestId", json!("not-a-uuid")),
    ] {
        let mut invalid = original.clone();
        invalid[field] = value;
        assert_eq!(
            decode_request(&serde_json::to_vec(&invalid).unwrap()),
            Err(ProtocolError::InvalidEnvelope)
        );
    }
    for invalid in [
        json!({"kind":"initialize","extra":true}),
        json!({"kind":"shutdown","extra":true}),
        json!({"kind":"shellExec"}),
        json!({"kind":"previewImport","sourcePath":"/tmp/a","extra":true}),
    ] {
        let mut value = original.clone();
        value["body"] = invalid;
        assert_eq!(
            decode_request(&serde_json::to_vec(&value).unwrap()),
            Err(ProtocolError::InvalidFrame)
        );
    }
    let mut invalid = original;
    invalid["extra"] = json!(true);
    assert_eq!(
        decode_request(&serde_json::to_vec(&invalid).unwrap()),
        Err(ProtocolError::InvalidFrame)
    );
    for invalid in [b"\xff".as_slice(), b"{}{}", b"{}\n", b"{", b"[]"] {
        assert_eq!(decode_request(invalid), Err(ProtocolError::InvalidFrame));
    }
}

#[test]
fn rejects_unknown_reply_fields_and_error_codes_and_checks_capability() {
    let request = request(RequestBody::Initialize);
    let response = Response::for_request(
        &request,
        ResponseBody::Initialized {
            capability: CAPABILITY_ID.into(),
            version: 1,
        },
    );
    assert_eq!(response.validate_for_request(&request), Ok(()));
    for (field, value) in [
        ("capability", json!("writing.other")),
        ("version", json!(2)),
        ("extra", json!(true)),
    ] {
        let mut invalid = serde_json::to_value(&response).unwrap();
        invalid["body"][field] = value;
        assert!(decode_response(&serde_json::to_vec(&invalid).unwrap()).is_err());
    }
    let request = super::tests::request(RequestBody::PreviewImport {
        source_path: "/tmp/a".into(),
    });
    let failure = Response::for_request(
        &request,
        ResponseBody::PreviewImportResult {
            outcome: PreviewOutcome::Failure {
                error: PreviewFailure {
                    code: PreviewErrorCode::InvalidInput,
                    message: "稿件路径无效".into(),
                },
            },
        },
    );
    let mut invalid = serde_json::to_value(&failure).unwrap();
    assert_eq!(invalid["body"]["outcome"]["error"]["code"], "invalid_input");
    invalid["body"]["outcome"]["error"]["code"] = json!("plugin_host_timeout");
    assert_eq!(
        decode_response(&serde_json::to_vec(&invalid).unwrap()),
        Err(ProtocolError::InvalidFrame)
    );
    let mut invalid = serde_json::to_value(Response::for_request(
        &request,
        ResponseBody::ShutdownComplete,
    ))
    .unwrap();
    invalid["body"]["extra"] = json!(true);
    assert_eq!(
        decode_response(&serde_json::to_vec(&invalid).unwrap()),
        Err(ProtocolError::InvalidFrame)
    );
    let mut invalid = serde_json::to_value(&failure).unwrap();
    invalid["body"]["outcome"]["error"]["extra"] = json!(true);
    assert_eq!(
        decode_response(&serde_json::to_vec(&invalid).unwrap()),
        Err(ProtocolError::InvalidFrame)
    );
}

#[test]
fn error_budget_counts_utf8_bytes_and_never_truncates() {
    let request = request(RequestBody::PreviewImport {
        source_path: "/tmp/a".into(),
    });
    let mut response = Response::for_request(
        &request,
        ResponseBody::PreviewImportResult {
            outcome: PreviewOutcome::Failure {
                error: PreviewFailure {
                    code: PreviewErrorCode::StorageError,
                    message: "é".repeat(MAX_ERROR_BYTES / 2),
                },
            },
        },
    );
    assert!(encode_response(&response).is_ok());
    let ResponseBody::PreviewImportResult {
        outcome: PreviewOutcome::Failure { error },
    } = &mut response.body
    else {
        unreachable!()
    };
    error.message.push('a');
    assert_eq!(encode_response(&response), Err(ProtocolError::ErrorBudget));
    assert_eq!(
        decode_response(&serde_json::to_vec(&response).unwrap()),
        Err(ProtocolError::ErrorBudget)
    );
}

#[test]
fn valid_large_preview_exceeds_mcp_budget_without_changing_mcp_decoder() {
    let request = request(RequestBody::PreviewImport {
        source_path: "/tmp/a".into(),
    });
    let response = Response::for_request(
        &request,
        result(ImportPreview {
            file_count: 3_000,
            byte_size: 3_000,
            root_candidates: (0..3_000)
                .map(|index| format!("{index:04}/{}.tex", "x".repeat(980)))
                .collect(),
        }),
    );
    let wire = encode_response(&response).unwrap();
    assert!(wire.len() > 2 * 1024 * 1024);
    assert!(FrameDecoder::new().push(&wire).is_err());
    let mut decoder = FrameDecoder::with_max_frame_bytes(MAX_FRAME_BYTES);
    let mut frames = Vec::new();
    for chunk in wire.chunks(8_192) {
        frames.extend(decoder.push(chunk).unwrap());
    }
    assert!(decoder.is_empty());
    assert_eq!(frames.len(), 1);
    assert_eq!(decode_response(&frames[0]).unwrap(), response);
}

#[test]
fn preview_results_keep_original_count_byte_and_path_limits() {
    let request = request(RequestBody::PreviewImport {
        source_path: "/tmp/a".into(),
    });
    let boundary = ImportPreview {
        file_count: 10_000,
        byte_size: 512 * 1024 * 1024,
        root_candidates: vec![format!("{}.tex", "é".repeat(510))],
    };
    let response = Response::for_request(&request, result(boundary.clone()));
    let wire = encode_response(&response).unwrap();
    assert_eq!(decode_response(&wire[..wire.len() - 1]).unwrap(), response);

    let unchanged = ImportPreview {
        file_count: 3,
        byte_size: 1,
        root_candidates: vec!["z.tex".into(), "main.tex".into(), "a//b.tex".into()],
    };
    let response = Response::for_request(&request, result(unchanged));
    let wire = encode_response(&response).unwrap();
    assert_eq!(decode_response(&wire[..wire.len() - 1]).unwrap(), response);

    let mut invalid = vec![
        ImportPreview {
            file_count: 10_001,
            ..boundary.clone()
        },
        ImportPreview {
            file_count: u64::MAX,
            ..boundary.clone()
        },
        ImportPreview {
            byte_size: 512 * 1024 * 1024 + 1,
            ..boundary.clone()
        },
        ImportPreview {
            byte_size: u64::MAX,
            ..boundary.clone()
        },
        ImportPreview {
            file_count: 0,
            ..boundary.clone()
        },
    ];
    for path in [
        "x".repeat(1025),
        "../main.tex".into(),
        "/main.tex".into(),
        "CON.tex".into(),
        ".agent-before-root.tex".into(),
    ] {
        invalid.push(ImportPreview {
            root_candidates: vec![path],
            ..boundary.clone()
        });
    }
    for preview in invalid {
        let response = Response::for_request(&request, result(preview));
        assert_eq!(
            encode_response(&response),
            Err(ProtocolError::InvalidPreview)
        );
        assert_eq!(
            decode_response(&serde_json::to_vec(&response).unwrap()),
            Err(ProtocolError::InvalidPreview)
        );
    }
}

#[test]
fn complete_wire_budget_includes_newline_and_rejects_one_byte_over() {
    let mut request = request(RequestBody::PreviewImport {
        source_path: String::new(),
    });
    let overhead = encode_request(&request).unwrap().len();
    let RequestBody::PreviewImport { source_path } = &mut request.body else {
        unreachable!()
    };
    *source_path = "x".repeat(MAX_FRAME_BYTES - overhead);
    let wire = encode_request(&request).unwrap();
    assert_eq!(wire.len(), MAX_FRAME_BYTES);
    let frames = FrameDecoder::with_max_frame_bytes(MAX_FRAME_BYTES)
        .push(&wire)
        .unwrap();
    assert_eq!(decode_request(&frames[0]).unwrap(), request);
    drop(frames);
    drop(wire);
    let RequestBody::PreviewImport { source_path } = &mut request.body else {
        unreachable!()
    };
    source_path.push('x');
    assert_eq!(encode_request(&request), Err(ProtocolError::FrameBudget));
    assert_eq!(
        decode_request(&vec![b'x'; MAX_FRAME_BYTES]),
        Err(ProtocolError::FrameBudget)
    );
}
