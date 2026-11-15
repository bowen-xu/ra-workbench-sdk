//! Bounded transport-neutral framing and shared diagnostics.
const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug)]
pub struct FrameDecoder {
    buffer: Vec<u8>,
    max_frame_bytes: usize,
    legacy_chunk_budget: bool,
}

impl Default for FrameDecoder {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            max_frame_bytes: MAX_FRAME_BYTES,
            legacy_chunk_budget: true,
        }
    }
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Use an inclusive per-frame wire budget, including LF or CRLF. A zero
    /// budget accepts no data. Existing MCP callers retain their legacy budget
    /// policy through `new`/`default`; this does not change MCP encode/decode.
    pub fn with_max_frame_bytes(max_frame_bytes: usize) -> Self {
        Self {
            buffer: Vec::new(),
            max_frame_bytes,
            legacy_chunk_budget: false,
        }
    }

    /// Feed an arbitrary stdout chunk and return complete newline-delimited
    /// frames. Partial JSON is retained until the next chunk.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>, Error> {
        if self.legacy_chunk_budget
            && self.buffer.len().saturating_add(chunk.len()) >= self.max_frame_bytes
        {
            return Err(Error::FrameBudget);
        }
        let mut frames = Vec::new();
        let mut remaining = chunk;
        while let Some(index) = remaining.iter().position(|byte| *byte == b'\n') {
            let segment = &remaining[..=index];
            if self.buffer.len().saturating_add(segment.len()) > self.max_frame_bytes {
                return Err(Error::FrameBudget);
            }
            self.buffer.extend_from_slice(segment);
            remaining = &remaining[index + 1..];
            let mut frame = std::mem::take(&mut self.buffer);
            frame.pop();
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            if frame.is_empty() {
                return Err(Error::FrameBudget);
            }
            frames.push(frame);
        }
        if !remaining.is_empty() {
            // A partial frame still needs room for its terminating newline.
            if self.buffer.len().saturating_add(remaining.len()) >= self.max_frame_bytes {
                return Err(Error::FrameBudget);
            }
            self.buffer.extend_from_slice(remaining);
        }
        Ok(frames)
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("MCP frame exceeds its byte budget")]
    FrameBudget,
    #[error("invalid MCP JSON-RPC request")]
    InvalidRequest,
    #[error("MCP method is not supported")]
    UnsupportedMethod,
    #[error("MCP tool name is invalid")]
    InvalidTool,
    #[error("MCP tool list is invalid")]
    InvalidTools,
    #[error("MCP tool budget exceeded")]
    ToolBudget,
    #[error("MCP server returned an error: {0}")]
    Remote(String),
}
