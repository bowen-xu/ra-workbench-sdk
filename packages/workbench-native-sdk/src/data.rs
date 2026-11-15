//! Pure shapes for fixed, package-declared data resources.
//!
//! Validation grants no database access and does not execute SQL. Resource
//! admission, package identity, framing and transactions remain with the owner.

use serde::{Deserialize, Serialize, ser::SerializeStruct};

#[derive(Clone, Debug, PartialEq)]
pub enum DataValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl DataValue {
    /// Reject non-finite values before using a constructed or decoded value.
    pub fn validate(&self) -> Result<(), DataValueError> {
        if matches!(self, Self::Real(value) if !value.is_finite()) {
            return Err(DataValueError::NonFiniteReal);
        }
        Ok(())
    }

    /// Match an exact declared type; integers are not coerced to real values.
    pub fn validate_for(&self, field: &DataField) -> Result<(), DataValueError> {
        self.validate()?;
        if matches!(self, Self::Null) {
            return if field.nullable {
                Ok(())
            } else {
                Err(DataValueError::NullNotAllowed)
            };
        }
        if matches!(
            (self, field.data_type),
            (Self::Integer(_), DataType::Integer)
                | (Self::Real(_), DataType::Real)
                | (Self::Text(_), DataType::Text)
                | (Self::Blob(_), DataType::Blob)
        ) {
            Ok(())
        } else {
            Err(DataValueError::TypeMismatch {
                expected: field.data_type,
            })
        }
    }
}

impl Serialize for DataValue {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.validate().map_err(serde::ser::Error::custom)?;
        let mut wire = serializer.serialize_struct("DataValue", 2)?;
        let kind = match self {
            Self::Null => "null",
            Self::Integer(_) => "integer",
            Self::Real(_) => "real",
            Self::Text(_) => "text",
            Self::Blob(_) => "blob",
        };
        wire.serialize_field("kind", kind)?;
        match self {
            Self::Null => wire.serialize_field("value", &())?,
            Self::Integer(value) => wire.serialize_field("value", value)?,
            Self::Real(value) => wire.serialize_field("value", value)?,
            Self::Text(value) => wire.serialize_field("value", value)?,
            Self::Blob(value) => wire.serialize_field("value", value)?,
        }
        wire.end()
    }
}

impl<'de> Deserialize<'de> for DataValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // The null newtype requires an explicit value:null, unlike a unit
        // variant whose content can be omitted by Serde's tagged enum decoder.
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            content = "value",
            rename_all = "camelCase",
            deny_unknown_fields
        )]
        enum Wire {
            Null(()),
            Integer(i64),
            Real(f64),
            Text(String),
            Blob(Vec<u8>),
        }
        let value = match Wire::deserialize(deserializer)? {
            Wire::Null(()) => Self::Null,
            Wire::Integer(value) => Self::Integer(value),
            Wire::Real(value) => Self::Real(value),
            Wire::Text(value) => Self::Text(value),
            Wire::Blob(value) => Self::Blob(value),
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataType {
    Integer,
    Real,
    Text,
    Blob,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataField {
    pub data_type: DataType,
    pub nullable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataAccess {
    Read,
    Write,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataResourceGrant {
    pub id: String,
    pub version: u32,
    pub sha256: String,
    pub access: DataAccess,
    pub parameters: Vec<DataField>,
    pub columns: Vec<DataField>,
}

impl DataResourceGrant {
    /// Validate only the declaration. This does not verify resource bytes,
    /// resolve a package or authorize a call.
    pub fn validate(&self) -> Result<(), DataValidationError> {
        if self.id.is_empty()
            || !self
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        {
            return Err(DataValidationError::InvalidResourceId);
        }
        if self.version == 0 {
            return Err(DataValidationError::InvalidVersion);
        }
        if self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        {
            return Err(DataValidationError::InvalidResourceHash);
        }
        if matches!(self.access, DataAccess::Read) == self.columns.is_empty() {
            return Err(DataValidationError::InvalidColumns);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataCall {
    pub id: String,
    pub version: u32,
    pub arguments: Vec<DataValue>,
}

impl DataCall {
    /// Validate against the exact resource version, without coercing values.
    pub fn validate_for(&self, grant: &DataResourceGrant) -> Result<(), DataValidationError> {
        grant.validate()?;
        if self.id != grant.id || self.version != grant.version {
            return Err(DataValidationError::CallIdentityMismatch);
        }
        if self.arguments.len() != grant.parameters.len() {
            return Err(DataValidationError::ArgumentCount {
                expected: grant.parameters.len(),
                actual: self.arguments.len(),
            });
        }
        for (index, (value, field)) in self.arguments.iter().zip(&grant.parameters).enumerate() {
            value
                .validate_for(field)
                .map_err(|source| DataValidationError::Argument { index, source })?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataRows {
    pub rows: Vec<Vec<DataValue>>,
}

impl DataRows {
    /// Validate every row and column. No data is truncated or normalized.
    pub fn validate_for(&self, grant: &DataResourceGrant) -> Result<(), DataValidationError> {
        grant.validate()?;
        if grant.access != DataAccess::Read {
            return Err(DataValidationError::ResultAccessMismatch);
        }
        for (row, values) in self.rows.iter().enumerate() {
            if values.len() != grant.columns.len() {
                return Err(DataValidationError::ColumnCount {
                    row,
                    expected: grant.columns.len(),
                    actual: values.len(),
                });
            }
            for (column, (value, field)) in values.iter().zip(&grant.columns).enumerate() {
                value
                    .validate_for(field)
                    .map_err(|source| DataValidationError::Cell {
                        row,
                        column,
                        source,
                    })?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum DataResult {
    Rows(DataRows),
    Affected(u64),
}

impl DataResult {
    pub fn validate_for(&self, grant: &DataResourceGrant) -> Result<(), DataValidationError> {
        grant.validate()?;
        match self {
            Self::Rows(rows) => rows.validate_for(grant),
            Self::Affected(_) if grant.access == DataAccess::Write => Ok(()),
            Self::Affected(_) => Err(DataValidationError::ResultAccessMismatch),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DataValueError {
    #[error("real data values must be finite")]
    NonFiniteReal,
    #[error("null is not allowed for this field")]
    NullNotAllowed,
    #[error("data value does not have the declared {expected:?} type")]
    TypeMismatch { expected: DataType },
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DataValidationError {
    #[error("resource id must contain only ASCII letters, digits, dots, dashes or underscores")]
    InvalidResourceId,
    #[error("resource version must be positive")]
    InvalidVersion,
    #[error("resource hash must contain 64 lowercase hexadecimal digits")]
    InvalidResourceHash,
    #[error("read resources require columns and write resources cannot declare columns")]
    InvalidColumns,
    #[error("data call id or version does not match its declaration")]
    CallIdentityMismatch,
    #[error("data call requires {expected} arguments, received {actual}")]
    ArgumentCount { expected: usize, actual: usize },
    #[error("invalid data argument at index {index}: {source}")]
    Argument {
        index: usize,
        source: DataValueError,
    },
    #[error("data row {row} requires {expected} columns, received {actual}")]
    ColumnCount {
        row: usize,
        expected: usize,
        actual: usize,
    },
    #[error("invalid data value at row {row}, column {column}: {source}")]
    Cell {
        row: usize,
        column: usize,
        source: DataValueError,
    },
    #[error("data result does not match the declared resource access")]
    ResultAccessMismatch,
}

#[cfg(test)]
mod tests;
