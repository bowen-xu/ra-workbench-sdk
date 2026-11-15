//! Private bounded JSON framing shared by finite native protocol profiles.

use serde::{Serialize, de::DeserializeOwned};
use std::io::Write;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WireError {
    FrameBudget,
    InvalidFrame,
}

pub(crate) fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn valid_identity(package: &str, instance: &str, request: &str) -> bool {
    let canonical_uuid = |value: &str| {
        value.len() == 36
            && uuid::Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value)
    };
    is_digest(package) && canonical_uuid(instance) && canonical_uuid(request)
}

/// The budget includes the final LF; the supplied payload has no delimiter.
pub(crate) fn decode<T: DeserializeOwned>(
    payload: &[u8],
    max_frame_bytes: usize,
) -> Result<T, WireError> {
    if payload.is_empty() || payload.len() >= max_frame_bytes {
        return Err(WireError::FrameBudget);
    }
    if payload.contains(&b'\n') || payload.contains(&b'\r') {
        return Err(WireError::InvalidFrame);
    }
    serde_json::from_slice(payload).map_err(|_| WireError::InvalidFrame)
}

pub(crate) fn encode<T: Serialize + ?Sized>(
    value: &T,
    max_frame_bytes: usize,
) -> Result<Vec<u8>, WireError> {
    let mut buffer = FrameBuffer {
        bytes: Vec::new(),
        exceeded: false,
        max_frame_bytes,
    };
    if serde_json::to_writer(&mut buffer, value).is_err() {
        return Err(if buffer.exceeded {
            WireError::FrameBudget
        } else {
            WireError::InvalidFrame
        });
    }
    buffer.bytes.push(b'\n');
    Ok(buffer.bytes)
}

struct FrameBuffer {
    bytes: Vec<u8>,
    exceeded: bool,
    max_frame_bytes: usize,
}

impl Write for FrameBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.bytes.len().saturating_add(bytes.len()) >= self.max_frame_bytes {
            self.exceeded = true;
            return Err(std::io::Error::other("native plugin frame budget exceeded"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
