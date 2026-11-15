use super::*;
use serde_json::{Value, json};

mod catalog_tests;

fn request(body: RequestBody) -> Request {
    Request {
        protocol_version: PROTOCOL_VERSION,
        plugin_id: PLUGIN_ID.into(),
        package_key: "a".repeat(64),
        instance_id: "8cbfd428-3ac1-4bce-b4f6-d41f31063d8e".into(),
        request_id: "590c18c0-52f2-4905-8e39-23e082778384".into(),
        body,
    }
}

fn decide_request() -> Request {
    let mut request = request(RequestBody::Initialize);
    request.body = RequestBody::DecideNoteTrace {
        snapshot: SnapshotRef::for_request(&request, 42, "b".repeat(64)),
    };
    request
}

fn payload(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}

#[test]
fn finite_request_and_snapshot_have_exact_shapes_and_raw_domain_input() {
    let request = decide_request();
    let wire = encode_request(&request).unwrap();
    let value: Value = serde_json::from_slice(&wire).unwrap();
    assert_eq!(
        value,
        json!({
            "protocolVersion":2,"pluginId":"literature_library","packageKey":"a".repeat(64),
            "instanceId":request.instance_id,"requestId":request.request_id,
            "body":{"kind":"decideNoteTrace","snapshot":{
                "relativeHandle":format!("note-trace-{}.json",request.request_id),"byteSize":42,
                "sha256":"b".repeat(64),"packageKey":"a".repeat(64),
                "instanceId":request.instance_id,"requestId":request.request_id
            }}
        })
    );
    assert_eq!(wire.last(), Some(&b'\n'));
    assert_eq!(decode_request(&wire[..wire.len() - 1]).unwrap(), request);

    let input = SnapshotInput {
        query: "  原问题\t ".into(),
        row: None,
    };
    assert_eq!(
        serde_json::to_value(&input).unwrap(),
        json!({"query":"  原问题\t ","row":null})
    );
    assert_eq!(
        serde_json::from_value::<SnapshotInput>(serde_json::to_value(&input).unwrap()).unwrap(),
        input
    );
    for invalid in [
        json!({"query":"q"}),
        json!({"query":"q","row":null,"scopeId":"paper"}),
        json!({"query":"q","row":null,"sql":"secret"}),
        json!({"query":null,"row":null}),
    ] {
        assert!(serde_json::from_value::<SnapshotInput>(invalid).is_err());
    }
}

#[test]
fn rejects_path_identity_version_and_authority_drift() {
    let original = serde_json::to_value(decide_request()).unwrap();
    for path in [
        "../private.json",
        "/private.json",
        "sub/input.json",
        "input.json",
        "note-trace-590c18c0-52f2-4905-8e39-23e082778384.json/extra",
    ] {
        let mut value = original.clone();
        value["body"]["snapshot"]["relativeHandle"] = json!(path);
        assert_eq!(
            decode_request(&payload(&value)),
            Err(ProtocolError::InvalidSnapshot)
        );
    }
    for field in ["packageKey", "instanceId", "requestId"] {
        let mut value = original.clone();
        value["body"]["snapshot"][field] = json!("different");
        assert_eq!(
            decode_request(&payload(&value)),
            Err(ProtocolError::InvalidSnapshot)
        );
    }
    for mutate in [
        |value: &mut Value| value["protocolVersion"] = json!(1),
        |value: &mut Value| value["pluginId"] = json!("writing_projects"),
        |value: &mut Value| value["requestId"] = json!("INVALID"),
        |value: &mut Value| value["packageKey"] = json!("A".repeat(64)),
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert_eq!(
            decode_request(&payload(&value)),
            Err(ProtocolError::InvalidEnvelope)
        );
    }
    for mutate in [
        |value: &mut Value| value["body"]["sql"] = json!("secret"),
        |value: &mut Value| value["body"]["snapshot"]["contextText"] = json!("secret"),
        |value: &mut Value| value["body"]["kind"] = json!("execute"),
    ] {
        let mut value = original.clone();
        mutate(&mut value);
        assert_eq!(
            decode_request(&payload(&value)),
            Err(ProtocolError::InvalidFrame)
        );
    }
    for body in [
        json!({"kind":"initialize","extra":true}),
        json!({"kind":"shutdown","extra":true}),
    ] {
        let mut value = original.clone();
        value["body"] = body;
        assert_eq!(
            decode_request(&payload(&value)),
            Err(ProtocolError::InvalidFrame)
        );
    }
}

#[test]
fn accepts_only_original_ready_postcondition_and_five_rejections() {
    let request = decide_request();
    let original = Response::for_request(
        &request,
        ResponseBody::NoteTraceDecision {
            decision: TraceDecision::Ready {
                mark_sent: MarkSentCondition::ORIGINAL,
            },
        },
    );
    let wire = encode_response(&original).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&wire).unwrap()["body"]["decision"],
        json!({"status":"ready","markSent":{"expectedRows":1,"onMismatch":"already_consumed"}})
    );
    for count in [0, 2, u64::MAX] {
        let mut value = serde_json::to_value(&original).unwrap();
        value["body"]["decision"]["markSent"]["expectedRows"] = json!(count);
        assert_eq!(
            decode_response(&payload(&value)),
            Err(ProtocolError::InvalidDecision)
        );
    }
    let mut value = serde_json::to_value(&original).unwrap();
    value["body"]["decision"]["markSent"]["onMismatch"] = json!("not_found");
    assert_eq!(
        decode_response(&payload(&value)),
        Err(ProtocolError::InvalidDecision)
    );
    for reason in [
        TraceRejection::NotFound,
        TraceRejection::QueryMismatch,
        TraceRejection::AlreadyConsumed,
        TraceRejection::Expired,
        TraceRejection::ContextHashMismatch,
    ] {
        let response = Response::for_request(
            &request,
            ResponseBody::NoteTraceDecision {
                decision: TraceDecision::Rejected { reason },
            },
        );
        let wire = encode_response(&response).unwrap();
        let decoded = decode_response(&wire[..wire.len() - 1]).unwrap();
        decoded.validate_for_request(&request).unwrap();
        assert_eq!(decoded, response);
    }
    for decision in [
        json!({"status":"ready","markSent":{"expectedRows":1,"onMismatch":"already_consumed"},"sql":[]}),
        json!({"status":"rejected","reason":"other"}),
        json!({"status":"rejected","reason":"expired","contextText":"secret"}),
    ] {
        let mut value = serde_json::to_value(&original).unwrap();
        value["body"]["decision"] = decision;
        assert_eq!(
            decode_response(&payload(&value)),
            Err(ProtocolError::InvalidFrame)
        );
    }
}

#[test]
fn matches_full_response_identity_and_only_the_requested_reply_kind() {
    let request = decide_request();
    let original = Response::for_request(
        &request,
        ResponseBody::NoteTraceDecision {
            decision: TraceDecision::Rejected {
                reason: TraceRejection::Expired,
            },
        },
    );
    for field in ["packageKey", "instanceId", "requestId"] {
        let mut value = serde_json::to_value(&original).unwrap();
        value[field] = if field == "packageKey" {
            json!("b".repeat(64))
        } else {
            json!("bc27daa2-3ef5-43b5-bc5b-e9ca02081b12")
        };
        let response: Response = serde_json::from_value(value).unwrap();
        assert_eq!(
            response.validate_for_request(&request),
            Err(ProtocolError::ResponseMismatch)
        );
    }
    let response = Response::for_request(&request, ResponseBody::ShutdownComplete);
    assert_eq!(
        response.validate_for_request(&request),
        Err(ProtocolError::ResponseMismatch)
    );
    let response = Response::for_request(
        &request,
        ResponseBody::Initialized {
            capability: "other".into(),
            version: 1,
        },
    );
    assert_eq!(
        validate_response(&response),
        Err(ProtocolError::InvalidEnvelope)
    );
    let mut value = serde_json::to_value(Response::for_request(
        &request,
        ResponseBody::ShutdownComplete,
    ))
    .unwrap();
    value["body"]["extra"] = json!(true);
    assert_eq!(
        decode_response(&payload(&value)),
        Err(ProtocolError::InvalidFrame)
    );
}

#[test]
fn bounded_wire_errors_do_not_adopt_the_writing_profile() {
    assert_eq!(decode_request(b""), Err(ProtocolError::FrameBudget));
    assert_eq!(decode_request(b"{}\n"), Err(ProtocolError::InvalidFrame));
    assert_eq!(decode_request(b"{"), Err(ProtocolError::InvalidFrame));
    let writing = crate::protocol::Request {
        protocol_version: 1,
        plugin_id: "writing_projects".into(),
        package_key: "a".repeat(64),
        instance_id: "8cbfd428-3ac1-4bce-b4f6-d41f31063d8e".into(),
        request_id: "590c18c0-52f2-4905-8e39-23e082778384".into(),
        body: crate::protocol::RequestBody::Initialize,
    };
    let bytes = crate::protocol::encode_request(&writing).unwrap();
    assert_eq!(
        decode_request(&bytes[..bytes.len() - 1]),
        Err(ProtocolError::InvalidEnvelope)
    );
    let bytes = encode_request(&request(RequestBody::Initialize)).unwrap();
    assert_eq!(
        crate::protocol::decode_request(&bytes[..bytes.len() - 1]),
        Err(crate::protocol::ProtocolError::InvalidEnvelope)
    );
}
