use super::*;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Value, json};

#[test]
fn typed_float_bits_and_dynamic_json_values_survive_both_binary_directions() {
    let floats = [
        0.09090909090909091,
        2.0149999999999998e-10,
        -0.0,
        f64::MIN_POSITIVE,
        f64::from_bits(1),
        f64::MAX,
        -f64::MAX,
    ];
    let restored: Vec<f64> = decode_payload(&encode_payload(&floats).unwrap()).unwrap();
    assert_eq!(
        restored.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
        floats.map(f64::to_bits)
    );
    let value = json!({
        "integers": [i64::MIN, i64::MAX, u64::MAX, 0],
        "floats": floats,
        "text": "Unicode 汉字 α🧪\n\0",
        "table": {"z": [true, false, null], "a": {"nested": [1, "原文"]}}
    });
    let restored: Value = decode_payload(&encode_payload(&value).unwrap()).unwrap();
    assert_eq!(restored, value);
    for (original, restored) in value["floats"]
        .as_array()
        .unwrap()
        .iter()
        .zip(restored["floats"].as_array().unwrap())
    {
        assert_eq!(
            original.as_f64().unwrap().to_bits(),
            restored.as_f64().unwrap().to_bits()
        );
    }
    assert_eq!(restored["integers"][0].as_i64(), Some(i64::MIN));
    assert_eq!(restored["integers"][2].as_u64(), Some(u64::MAX));
}

#[test]
fn absent_payload_bad_base64_truncation_syntax_type_and_exact_eof_have_safe_closed_errors() {
    assert_eq!(
        decode_payload::<Value>("").unwrap_err(),
        PaperContextCodecError {
            kind: PaperContextCodecErrorKind::Truncated,
            offset: Some(0),
        }
    );
    assert_eq!(
        decode_payload::<Value>("PRIVATE_BODY_%").unwrap_err().kind,
        PaperContextCodecErrorKind::Base64
    );
    let cases: &[(Vec<u8>, PaperContextCodecErrorKind)] = &[
        (vec![0x1b, 0], PaperContextCodecErrorKind::Truncated),
        (vec![0xff], PaperContextCodecErrorKind::Semantic),
        (vec![0x1c], PaperContextCodecErrorKind::Syntax),
        (vec![0x61, 0xff], PaperContextCodecErrorKind::Syntax),
        (vec![0xf6, 0xf6], PaperContextCodecErrorKind::Trailing),
        (vec![0xf6, 0xff], PaperContextCodecErrorKind::Trailing),
    ];
    for (bytes, expected) in cases {
        let error = decode_payload::<Value>(&STANDARD.encode(bytes)).unwrap_err();
        assert_eq!(error.kind, *expected);
        if *expected != PaperContextCodecErrorKind::Semantic {
            assert!(error.offset.is_some());
        }
    }
    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Empty {}
    let error = decode_payload::<Empty>(
        &encode_payload(&json!({"PRIVATE_FIELD_497": "PRIVATE_BODY_497"})).unwrap(),
    )
    .unwrap_err();
    assert_eq!(error.kind, PaperContextCodecErrorKind::Semantic);
    for diagnostic in [format!("{error}"), format!("{error:?}")] {
        assert!(!diagnostic.contains("PRIVATE_"));
    }
    assert_eq!(
        decode_payload::<u64>(&encode_payload(&"PRIVATE_BODY_497").unwrap())
            .unwrap_err()
            .kind,
        PaperContextCodecErrorKind::Semantic
    );
}

#[test]
fn recursion_budget_is_fixed_and_checks_nested_values_before_unbounded_decode() {
    let shallow = [vec![0x81; 200], vec![0xf6]].concat();
    assert!(decode_payload::<Value>(&STANDARD.encode(shallow)).is_ok());
    let deep = [vec![0x81; 257], vec![0xf6]].concat();
    let error = decode_payload::<Value>(&STANDARD.encode(deep)).unwrap_err();
    assert_eq!(error.kind, PaperContextCodecErrorKind::Depth);
    assert!(error.offset.is_some());
}

#[test]
fn visitor_and_serializer_private_messages_never_escape_the_codec() {
    struct FailingSerialize;
    impl Serialize for FailingSerialize {
        fn serialize<S: Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
            Err(serde::ser::Error::custom("PRIVATE_BODY_497"))
        }
    }
    #[derive(Debug)]
    struct FailingDeserialize;
    impl<'de> Deserialize<'de> for FailingDeserialize {
        fn deserialize<D: Deserializer<'de>>(_: D) -> Result<Self, D::Error> {
            Err(serde::de::Error::custom("PRIVATE_BODY_497"))
        }
    }
    let encoded = encode_payload(&FailingSerialize).unwrap_err();
    let decoded = decode_payload::<FailingDeserialize>(&encode_payload(&0).unwrap()).unwrap_err();
    assert_eq!(encoded.kind, PaperContextCodecErrorKind::Encode);
    assert_eq!(decoded.kind, PaperContextCodecErrorKind::Semantic);
    for error in [encoded, decoded] {
        assert!(!error.to_string().contains("PRIVATE_"));
        assert!(!format!("{error:?}").contains("PRIVATE_"));
    }
}
