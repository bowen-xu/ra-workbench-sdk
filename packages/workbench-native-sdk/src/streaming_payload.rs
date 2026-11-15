//! The original native payload codec over caller-owned streams.
//! No path, file, process, lifetime or database owner is created here.
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::io::{self, BufReader, BufWriter, Read, Write};

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum PayloadError {
    #[error("native payload JSON {category} at line {line}, column {column}")]
    Invalid {
        category: String,
        line: usize,
        column: usize,
        io_kind: Option<io::ErrorKind>,
    },
    #[error("native payload length or SHA-256 differs")]
    Integrity,
    #[error("native payload serialization failed: {0:?}")]
    Serialization(io::ErrorKind),
    #[error("native payload stream failed: {0:?}")]
    Io(io::ErrorKind),
}

pub struct PayloadDigest {
    pub byte_size: u64,
    pub sha256: String,
}

struct VerifiedRead<R> {
    source: R,
    hash: Sha256,
    bytes: u64,
}
impl<R: Read> Read for VerifiedRead<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.source.read(buffer)?;
        self.hash.update(&buffer[..count]);
        self.bytes += count as u64;
        Ok(count)
    }
}

/// Hash the same bytes that are decoded, including one growth-detection byte.
/// The original caller-supplied byte length is independent of pipe frame limits.
pub fn read_json<R: Read, T: DeserializeOwned>(
    source: R,
    byte_size: u64,
    sha256: &str,
) -> Result<T, PayloadError> {
    let limit = byte_size.checked_add(1).ok_or(PayloadError::Integrity)?;
    let mut reader = BufReader::new(VerifiedRead {
        source: source.take(limit),
        hash: Sha256::new(),
        bytes: 0,
    });
    let value = serde_json::from_reader(&mut reader).map_err(|error| PayloadError::Invalid {
        category: format!("{:?}", error.classify()),
        line: error.line(),
        column: error.column(),
        io_kind: error.io_error_kind(),
    })?;
    let verified = reader.into_inner();
    if verified.bytes != byte_size || format!("{:x}", verified.hash.finalize()) != sha256 {
        return Err(PayloadError::Integrity);
    }
    Ok(value)
}

struct DigestWrite<W> {
    sink: W,
    hash: Sha256,
    bytes: u64,
}
impl<W: Write> Write for DigestWrite<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let count = self.sink.write(bytes)?;
        self.hash.update(&bytes[..count]);
        self.bytes = self
            .bytes
            .checked_add(count as u64)
            .ok_or_else(|| io::Error::other("payload size overflow"))?;
        Ok(count)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.sink.flush()
    }
}

/// Return the original sink so its owner can sync, chmod and retain its lease.
pub fn write_json<W: Write, T: Serialize + ?Sized>(
    sink: W,
    value: &T,
) -> Result<(W, PayloadDigest), PayloadError> {
    let mut writer = BufWriter::new(DigestWrite {
        sink,
        hash: Sha256::new(),
        bytes: 0,
    });
    serde_json::to_writer(&mut writer, value).map_err(|error| {
        PayloadError::Serialization(error.io_error_kind().unwrap_or(io::ErrorKind::InvalidData))
    })?;
    writer
        .flush()
        .map_err(|error| PayloadError::Io(error.kind()))?;
    let writer = writer
        .into_inner()
        .map_err(|error| PayloadError::Io(error.error().kind()))?;
    let digest = PayloadDigest {
        byte_size: writer.bytes,
        sha256: format!("{:x}", writer.hash.finalize()),
    };
    Ok((writer.sink, digest))
}

#[cfg(test)]
mod tests;
