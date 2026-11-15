//! Typed payload transport only; the outer Catalog and stored JSON are unchanged.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Serialize, de::DeserializeOwned};

const PAYLOAD_RECURSION_LIMIT: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaperContextCodecErrorKind {
    Base64,
    Encode,
    Syntax,
    Semantic,
    Depth,
    Truncated,
    Trailing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("paper_context_payload_{kind}")]
pub struct PaperContextCodecError {
    pub kind: PaperContextCodecErrorKind,
    /// Input base64 byte index for Base64; decoded CBOR offset otherwise.
    pub offset: Option<usize>,
}

impl std::fmt::Display for PaperContextCodecErrorKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Base64 => "base64",
            Self::Encode => "encode",
            Self::Syntax => "syntax",
            Self::Semantic => "semantic",
            Self::Depth => "depth",
            Self::Truncated => "truncated",
            Self::Trailing => "trailing",
        })
    }
}

pub fn encode_payload<T: Serialize>(value: &T) -> Result<String, PaperContextCodecError> {
    let mut bytes = Vec::new();
    ciborium::ser::into_writer(value, &mut bytes).map_err(|_| PaperContextCodecError {
        kind: PaperContextCodecErrorKind::Encode,
        offset: None,
    })?;
    Ok(STANDARD.encode(bytes))
}

pub fn decode_payload<T: DeserializeOwned>(encoded: &str) -> Result<T, PaperContextCodecError> {
    let bytes = STANDARD.decode(encoded).map_err(|error| {
        let offset = match error {
            base64::DecodeError::InvalidByte(offset, _)
            | base64::DecodeError::InvalidLastSymbol(offset, _)
            | base64::DecodeError::InvalidLength(offset) => Some(offset),
            base64::DecodeError::InvalidPadding => None,
        };
        PaperContextCodecError {
            kind: PaperContextCodecErrorKind::Base64,
            offset,
        }
    })?;
    let mut remaining = bytes.as_slice();
    let decoded =
        ciborium::de::from_reader_with_recursion_limit(&mut remaining, PAYLOAD_RECURSION_LIMIT)
            .map_err(|error| {
                use ciborium::de::Error;
                let (kind, offset) = match error {
                    Error::Io(_) => (
                        PaperContextCodecErrorKind::Truncated,
                        Some(bytes.len() - remaining.len()),
                    ),
                    Error::Syntax(offset) => (PaperContextCodecErrorKind::Syntax, Some(offset)),
                    // Visitor messages can contain payload values or private field names.
                    Error::Semantic(offset, _) => (PaperContextCodecErrorKind::Semantic, offset),
                    Error::RecursionLimitExceeded => (
                        PaperContextCodecErrorKind::Depth,
                        Some(bytes.len() - remaining.len()),
                    ),
                };
                PaperContextCodecError { kind, offset }
            })?;
    if !remaining.is_empty() {
        return Err(PaperContextCodecError {
            kind: PaperContextCodecErrorKind::Trailing,
            offset: Some(bytes.len() - remaining.len()),
        });
    }
    Ok(decoded)
}

#[cfg(test)]
mod tests;
