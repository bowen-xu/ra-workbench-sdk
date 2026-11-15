use super::*;
use serde_json::json;

fn field(data_type: DataType, nullable: bool) -> DataField {
    DataField {
        data_type,
        nullable,
    }
}

fn grant() -> DataResourceGrant {
    DataResourceGrant {
        id: "nal.annotation.by-target".into(),
        version: 1,
        sha256: "a1".repeat(32),
        access: DataAccess::Read,
        parameters: vec![field(DataType::Text, false)],
        columns: vec![field(DataType::Integer, false), field(DataType::Text, true)],
    }
}

fn call(arguments: Vec<DataValue>) -> DataCall {
    let grant = grant();
    DataCall {
        id: grant.id,
        version: grant.version,
        arguments,
    }
}

#[test]
fn tagged_values_preserve_integer_limits_bytes_null_and_finite_reals() {
    for value in [
        DataValue::Null,
        DataValue::Integer(i64::MIN),
        DataValue::Integer(i64::MAX),
        DataValue::Integer(9_007_199_254_740_993),
        DataValue::Real(-f64::MAX),
        DataValue::Real(f64::MIN_POSITIVE),
        DataValue::Real(0.0),
        DataValue::Text("合成内容\0\n".into()),
        DataValue::Blob(vec![0, 127, 255]),
    ] {
        let wire = serde_json::to_string(&value).unwrap();
        assert_eq!(serde_json::from_str::<DataValue>(&wire).unwrap(), value);
    }
    assert_eq!(
        serde_json::to_value(DataValue::Null).unwrap(),
        json!({"kind":"null","value":null})
    );
    for wire in [
        r#"{"kind":"integer","value":9223372036854775808}"#,
        r#"{"kind":"integer","value":-9223372036854775809}"#,
        r#"{"kind":"integer","value":1.5}"#,
        r#"{"kind":"blob","value":[256]}"#,
        r#"{"kind":"null"}"#,
        r#"{"kind":"null","value":0}"#,
    ] {
        assert!(serde_json::from_str::<DataValue>(wire).is_err());
    }
}

#[test]
fn non_finite_reals_cannot_be_encoded_or_used_as_arguments_or_cells() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let value = DataValue::Real(value);
        assert_eq!(value.validate(), Err(DataValueError::NonFiniteReal));
        assert!(serde_json::to_string(&value).is_err());
        let mut declaration = grant();
        declaration.parameters = vec![field(DataType::Real, false)];
        assert_eq!(
            call(vec![value.clone()]).validate_for(&declaration),
            Err(DataValidationError::Argument {
                index: 0,
                source: DataValueError::NonFiniteReal,
            })
        );
        declaration.columns = vec![field(DataType::Real, false)];
        assert_eq!(
            DataRows {
                rows: vec![vec![value]],
            }
            .validate_for(&declaration),
            Err(DataValidationError::Cell {
                row: 0,
                column: 0,
                source: DataValueError::NonFiniteReal,
            })
        );
    }
    assert!(serde_json::from_str::<DataValue>(r#"{"kind":"real","value":1e400}"#).is_err());
}

#[test]
fn wire_shapes_reject_unknown_fields_and_unknown_variants() {
    for wire in [
        json!({"kind":"null","value":null,"extra":1}),
        json!({"kind":"integer","value":1,"sql":"unused"}),
        json!({"kind":"text","value":"s","extra":null}),
        json!({"kind":"date","value":"2026-11-05"}),
    ] {
        assert!(serde_json::from_value::<DataValue>(wire).is_err());
    }
    let mut wire = serde_json::to_value(grant()).unwrap();
    wire["sql"] = json!("unused");
    assert!(serde_json::from_value::<DataResourceGrant>(wire).is_err());
    let mut wire = serde_json::to_value(grant()).unwrap();
    wire["parameters"][0]["extra"] = json!(true);
    assert!(serde_json::from_value::<DataResourceGrant>(wire).is_err());
    assert!(
        serde_json::from_value::<DataCall>(json!({
            "id":"x","version":1,"arguments":[],"sql":"unused"
        }))
        .is_err()
    );
    assert!(serde_json::from_value::<DataRows>(json!({"rows":[],"truncated":true})).is_err());
    for wire in [
        json!({"kind":"affected","value":0,"extra":1}),
        json!({"kind":"rows","value":{"rows":[],"extra":1}}),
        json!({"kind":"rawSql","value":"unused"}),
    ] {
        assert!(serde_json::from_value::<DataResult>(wire).is_err());
    }
}

#[test]
fn declarations_require_exact_resource_identity_hash_and_access_shape() {
    let original = grant();
    original.validate().unwrap();
    for id in ["", "sql/path", "sql\\path", "has space", "文献", "id\0"] {
        let mut value = original.clone();
        value.id = id.into();
        assert_eq!(
            value.validate(),
            Err(DataValidationError::InvalidResourceId)
        );
    }
    for hash in ["a".repeat(63), "A".repeat(64), "g".repeat(64)] {
        let mut value = original.clone();
        value.sha256 = hash;
        assert_eq!(
            value.validate(),
            Err(DataValidationError::InvalidResourceHash)
        );
    }
    let mut value = original.clone();
    value.version = 0;
    assert_eq!(value.validate(), Err(DataValidationError::InvalidVersion));
    value = original.clone();
    value.columns.clear();
    assert_eq!(value.validate(), Err(DataValidationError::InvalidColumns));
    value = original;
    value.access = DataAccess::Write;
    assert_eq!(value.validate(), Err(DataValidationError::InvalidColumns));
    value.columns.clear();
    value.validate().unwrap();
}

#[test]
fn calls_reject_wrong_versions_counts_nulls_and_type_coercion() {
    let mut declaration = grant();
    call(vec![DataValue::Text("target".into())])
        .validate_for(&declaration)
        .unwrap();
    let mut wrong = call(vec![DataValue::Text("target".into())]);
    wrong.version += 1;
    assert_eq!(
        wrong.validate_for(&declaration),
        Err(DataValidationError::CallIdentityMismatch)
    );
    wrong.version = declaration.version;
    wrong.id.push_str(".other");
    assert_eq!(
        wrong.validate_for(&declaration),
        Err(DataValidationError::CallIdentityMismatch)
    );
    assert_eq!(
        call(vec![]).validate_for(&declaration),
        Err(DataValidationError::ArgumentCount {
            expected: 1,
            actual: 0
        })
    );
    assert_eq!(
        call(vec![DataValue::Null]).validate_for(&declaration),
        Err(DataValidationError::Argument {
            index: 0,
            source: DataValueError::NullNotAllowed
        })
    );
    declaration.parameters[0].nullable = true;
    call(vec![DataValue::Null])
        .validate_for(&declaration)
        .unwrap();
    declaration.parameters[0] = field(DataType::Real, false);
    assert_eq!(
        call(vec![DataValue::Integer(1)]).validate_for(&declaration),
        Err(DataValidationError::Argument {
            index: 0,
            source: DataValueError::TypeMismatch {
                expected: DataType::Real
            }
        })
    );
}

#[test]
fn row_validation_checks_later_rows_and_every_column_without_truncation() {
    let declaration = grant();
    let mut result = DataRows {
        rows: vec![
            vec![DataValue::Integer(i64::MAX), DataValue::Null],
            vec![DataValue::Integer(2), DataValue::Text("second".into())],
        ],
    };
    let before = result.clone();
    result.validate_for(&declaration).unwrap();
    assert_eq!(result, before);
    result.rows[1].push(DataValue::Text("extra".into()));
    assert_eq!(
        result.validate_for(&declaration),
        Err(DataValidationError::ColumnCount {
            row: 1,
            expected: 2,
            actual: 3
        })
    );
    assert_eq!(result.rows[1].len(), 3);
    result.rows[1].pop();
    result.rows[1][1] = DataValue::Blob(vec![1]);
    assert_eq!(
        result.validate_for(&declaration),
        Err(DataValidationError::Cell {
            row: 1,
            column: 1,
            source: DataValueError::TypeMismatch {
                expected: DataType::Text
            }
        })
    );
    DataRows { rows: vec![] }
        .validate_for(&declaration)
        .unwrap();
}

#[test]
fn result_access_is_not_interchangeable_and_affected_counts_are_exact() {
    let read = grant();
    assert_eq!(
        DataResult::Affected(0).validate_for(&read),
        Err(DataValidationError::ResultAccessMismatch)
    );
    let mut write = read;
    write.access = DataAccess::Write;
    write.columns.clear();
    let affected = DataResult::Affected(u64::MAX);
    affected.validate_for(&write).unwrap();
    let wire = serde_json::to_string(&affected).unwrap();
    assert_eq!(serde_json::from_str::<DataResult>(&wire).unwrap(), affected);
    assert_eq!(
        DataResult::Rows(DataRows { rows: vec![] }).validate_for(&write),
        Err(DataValidationError::ResultAccessMismatch)
    );
}
