use super::*;

#[test]
fn original_json_bytes_round_trip_without_a_frame_budget() {
    let original = serde_json::json!({"text": "稿".repeat(10_000), "nullable": null});
    let (bytes, digest) = write_json(Vec::new(), &original).unwrap();
    assert_eq!(bytes, serde_json::to_vec(&original).unwrap());
    let decoded: serde_json::Value =
        read_json(bytes.as_slice(), digest.byte_size, &digest.sha256).unwrap();
    assert_eq!(decoded, original);
}

#[test]
fn altered_digest_and_growth_are_rejected_after_the_original_parse() {
    let (mut bytes, digest) = write_json(Vec::new(), &serde_json::json!({})).unwrap();
    assert!(matches!(
        read_json::<_, serde_json::Value>(bytes.as_slice(), digest.byte_size, &"0".repeat(64)),
        Err(PayloadError::Integrity)
    ));
    bytes.push(b' ');
    assert!(matches!(
        read_json::<_, serde_json::Value>(bytes.as_slice(), digest.byte_size, &digest.sha256),
        Err(PayloadError::Integrity)
    ));
    assert!(matches!(
        read_json::<_, serde_json::Value>(bytes.as_slice(), u64::MAX, &digest.sha256),
        Err(PayloadError::Integrity)
    ));
}

#[test]
fn parse_errors_retain_safe_classification_and_position() {
    let bytes = b"{\n  invalid";
    let result =
        read_json::<_, serde_json::Value>(bytes.as_slice(), bytes.len() as u64, &"0".repeat(64));
    assert!(
        matches!(result, Err(PayloadError::Invalid { category, line: 2, column: 3, io_kind: None }) if category == "Syntax")
    );
}

#[test]
fn original_sink_failure_keeps_its_error_kind() {
    struct Failing;
    impl Write for Failing {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let result = write_json(Failing, &serde_json::json!({"synthetic": true}));
    assert!(matches!(
        result,
        Err(PayloadError::Io(io::ErrorKind::PermissionDenied))
    ));
}
