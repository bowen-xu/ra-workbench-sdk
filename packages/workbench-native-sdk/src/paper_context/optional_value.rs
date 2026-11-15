//! Preserve the original JSON Option while distinguishing binary present-null.
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

#[derive(Serialize)]
enum BinaryValueRef<'a> {
    Absent,
    Present(&'a Value),
}

#[derive(Deserialize)]
enum BinaryValue {
    Absent,
    Present(Value),
}

pub(super) fn serialize<S: Serializer>(
    value: &Option<Value>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if serializer.is_human_readable() {
        return value.serialize(serializer);
    }
    match value {
        Some(value) => BinaryValueRef::Present(value),
        None => BinaryValueRef::Absent,
    }
    .serialize(serializer)
}

pub(super) fn deserialize<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Value>, D::Error> {
    if deserializer.is_human_readable() {
        return Option::<Value>::deserialize(deserializer);
    }
    Ok(match BinaryValue::deserialize(deserializer)? {
        BinaryValue::Absent => None,
        BinaryValue::Present(value) => Some(value),
    })
}
