//! Minimal MCP JSON-RPC boundary shared by native transports.
//!
//! This is intentionally transport-neutral: stdio framing, HTTP sessions,
//! credentials and child processes belong to desktop adapters. The checks
//! mirror Codex MCP's tool namespace and bounded request handling without
//! depending on a provider SDK.

use serde::{Deserialize, Serialize};
use serde_json::Value;
mod model_names;
mod thread_hint;
pub use model_names::{McpModelName, McpRawName, normalize_model_names};
pub use thread_hint::decode_thread_hint;

const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
const MAX_METHOD_BYTES: usize = 128;
const MAX_TOOL_BYTES: usize = 256;
const MAX_TOOLS: usize = 512;
const MAX_TOOL_DESCRIPTION_BYTES: usize = 64 * 1024;
const MAX_TOOL_RESULT_BYTES: usize = 1024 * 1024;

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub jsonrpc: String,
    pub id: u64,
    pub result: Option<Value>,
    pub error: Option<ErrorObject>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorObject {
    pub code: i64,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
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

/// Decode one newline-delimited MCP stdio frame after the transport has read a
/// complete line. HTTP adapters can use the same validation on their body.
pub fn decode_request(frame: &[u8]) -> Result<Request, Error> {
    if frame.is_empty() || frame.len() > MAX_FRAME_BYTES {
        return Err(Error::FrameBudget);
    }
    let request: Request = serde_json::from_slice(frame).map_err(|_| Error::InvalidRequest)?;
    validate_request(&request)?;
    Ok(request)
}

pub fn encode_request(request: &Request) -> Result<Vec<u8>, Error> {
    validate_request(request)?;
    let bytes = serde_json::to_vec(request).map_err(|_| Error::InvalidRequest)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(Error::FrameBudget);
    }
    Ok(bytes)
}

pub fn validate_request(request: &Request) -> Result<(), Error> {
    if request.jsonrpc != "2.0"
        || request.method.trim().is_empty()
        || request.method.len() > MAX_METHOD_BYTES
        || request.method.chars().any(char::is_control)
        || !request.params.is_object()
    {
        return Err(Error::InvalidRequest);
    }
    match request.method.as_str() {
        "initialize" | "tools/list" => Ok(()),
        "tools/call" => {
            let name = request
                .params
                .get("name")
                .and_then(Value::as_str)
                .ok_or(Error::InvalidTool)?;
            if name.trim().is_empty()
                || name.len() > MAX_TOOL_BYTES
                || name.chars().any(char::is_control)
            {
                return Err(Error::InvalidTool);
            }
            if let Some(arguments) = request.params.get("arguments")
                && !arguments.is_object()
            {
                return Err(Error::InvalidTool);
            }
            Ok(())
        }
        _ => Err(Error::UnsupportedMethod),
    }
}

pub fn encode_response(response: &Response) -> Result<Vec<u8>, Error> {
    validate_response(response)?;
    let bytes = serde_json::to_vec(response).map_err(|_| Error::InvalidRequest)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(Error::FrameBudget);
    }
    Ok(bytes)
}

pub fn decode_response(frame: &[u8], expected_id: u64) -> Result<Response, Error> {
    if frame.is_empty() || frame.len() > MAX_FRAME_BYTES {
        return Err(Error::FrameBudget);
    }
    let response: Response = serde_json::from_slice(frame).map_err(|_| Error::InvalidRequest)?;
    validate_response(&response)?;
    if response.id != expected_id {
        return Err(Error::InvalidRequest);
    }
    Ok(response)
}

/// Convert the wire-level `tools/list` response into the transport-neutral
/// descriptor consumed by the extension registry. The model never receives
/// the MCP envelope or server-owned implementation details.
pub fn decode_tools_list(response: Response) -> Result<Vec<ToolSpec>, Error> {
    if let Some(error) = response.error {
        return Err(Error::Remote(error.message));
    }
    let tools = response
        .result
        .and_then(|value| value.get("tools").cloned())
        .and_then(|value| value.as_array().cloned())
        .ok_or(Error::InvalidTools)?;
    if tools.len() > MAX_TOOLS {
        return Err(Error::ToolBudget);
    }
    let mut seen = std::collections::HashSet::new();
    let mut output = Vec::with_capacity(tools.len());
    for tool in tools {
        let name = tool
            .get("name")
            .and_then(Value::as_str)
            .ok_or(Error::InvalidTools)?;
        let description = tool
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let input_schema = tool
            .get("inputSchema")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({"type":"object"}));
        if name.trim().is_empty()
            || name.len() > MAX_TOOL_BYTES
            || name.chars().any(char::is_control)
            || description.len() > MAX_TOOL_DESCRIPTION_BYTES
            || !input_schema.is_object()
            || !seen.insert(name.to_owned())
        {
            return Err(Error::InvalidTools);
        }
        output.push(ToolSpec {
            name: name.to_owned(),
            description: description.to_owned(),
            input_schema,
        });
    }
    Ok(output)
}

/// Convert a `tools/call` response to the bounded result shape understood by
/// the runner. Only text blocks are joined; non-text blocks are retained as
/// compact JSON so a host can decide how to render them.
pub fn decode_tool_result(response: Response) -> Result<ToolResult, Error> {
    if let Some(error) = response.error {
        return Ok(ToolResult {
            content: error.message,
            is_error: true,
        });
    }
    let result = response.result.ok_or(Error::InvalidTools)?;
    let is_error = result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let content = match result.get("content") {
        Some(Value::Array(blocks)) => {
            let text = blocks
                .iter()
                .map(|block| {
                    block
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .unwrap_or_else(|| block.to_string())
                })
                .collect::<Vec<_>>()
                .join("\n");
            // MCP servers may return only structuredContent (the Codex RMCP
            // test server does this). Preserve it when the content block list
            // is empty instead of silently presenting an empty tool result.
            if text.is_empty() {
                result
                    .get("structuredContent")
                    .map(ToString::to_string)
                    .unwrap_or(text)
            } else {
                text
            }
        }
        Some(value) => value.to_string(),
        None => result.to_string(),
    };
    if content.len() > MAX_TOOL_RESULT_BYTES {
        return Err(Error::ToolBudget);
    }
    Ok(ToolResult { content, is_error })
}

fn validate_response(response: &Response) -> Result<(), Error> {
    if response.jsonrpc != "2.0"
        || (response.result.is_some() && response.error.is_some())
        || (response.result.is_none() && response.error.is_none())
        || response.error.as_ref().is_some_and(|error| {
            error.message.trim().is_empty()
                || error.message.chars().count() > 1_024
                || error.message.chars().any(char::is_control)
        })
    {
        return Err(Error::InvalidRequest);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_supported_tool_call_and_rejects_unknown_method() {
        let request = decode_request(br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"literature__search"}}"#).unwrap();
        assert_eq!(request.id, 1);
        let unknown = Request {
            method: "shell/exec".into(),
            ..request
        };
        assert_eq!(validate_request(&unknown), Err(Error::UnsupportedMethod));
        let invalid_arguments = Request {
            method: "tools/call".into(),
            params: json!({"name":"literature__search", "arguments": []}),
            ..unknown
        };
        assert_eq!(
            validate_request(&invalid_arguments),
            Err(Error::InvalidTool)
        );
    }

    #[test]
    fn enforces_jsonrpc_response_shape_and_frame_budget() {
        let response = Response {
            jsonrpc: "2.0".into(),
            id: 2,
            result: Some(json!({"ok":true})),
            error: None,
        };
        assert!(encode_response(&response).unwrap().starts_with(b"{"));
        let request = Request {
            jsonrpc: "2.0".into(),
            id: 7,
            method: "tools/list".into(),
            params: json!({}),
        };
        assert!(encode_request(&request).unwrap().starts_with(b"{"));
        assert_eq!(
            decode_response(&encode_response(&response).unwrap(), 2).unwrap(),
            response
        );
        assert_eq!(
            decode_response(&encode_response(&response).unwrap(), 3),
            Err(Error::InvalidRequest)
        );
        let invalid = Response {
            error: Some(ErrorObject {
                code: -1,
                message: "no".into(),
            }),
            ..response.clone()
        };
        assert_eq!(encode_response(&invalid), Err(Error::InvalidRequest));
        let oversized = Request {
            jsonrpc: "2.0".into(),
            id: 1,
            method: "initialize".into(),
            params: json!({"x":"a".repeat(MAX_FRAME_BYTES)}),
        };
        assert_eq!(validate_request(&oversized), Ok(()));
        assert_eq!(
            decode_request(&serde_json::to_vec(&oversized).unwrap()),
            Err(Error::FrameBudget)
        );
    }

    #[test]
    fn decodes_fragmented_crlf_frames_without_merging_messages() {
        let mut decoder = FrameDecoder::new();
        let mut first = br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#.to_vec();
        first.push(b'\r');
        assert!(decoder.push(&first).unwrap().is_empty());
        let frames = decoder
            .push(b"\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}\n")
            .unwrap();
        assert_eq!(frames.len(), 2);
        assert_eq!(decode_request(&frames[0]).unwrap().id, 1);
        assert_eq!(decode_request(&frames[1]).unwrap().id, 2);
        assert!(decoder.is_empty());
    }

    #[test]
    fn rejects_oversized_partial_frame_before_growth() {
        let mut decoder = FrameDecoder::new();
        assert_eq!(
            decoder.push(&vec![b'x'; MAX_FRAME_BYTES]),
            Err(Error::FrameBudget)
        );
    }

    #[test]
    fn default_decoder_keeps_legacy_chunk_budget_and_exact_limit_rejection() {
        for mut decoder in [FrameDecoder::new(), FrameDecoder::default()] {
            let mut exact = vec![b'x'; MAX_FRAME_BYTES - 1];
            exact.push(b'\n');
            assert_eq!(decoder.push(&exact), Err(Error::FrameBudget));
            assert!(decoder.is_empty());
            let combined = b"a\n".repeat(MAX_FRAME_BYTES / 2);
            assert_eq!(decoder.push(&combined), Err(Error::FrameBudget));
            assert!(decoder.is_empty());
        }
    }

    #[test]
    fn explicit_budget_is_per_frame_inclusive_and_counts_crlf() {
        let mut decoder = FrameDecoder::with_max_frame_bytes(4);
        assert_eq!(
            decoder.push(b"ab\r\ncde\na\n").unwrap(),
            [b"ab".to_vec(), b"cde".to_vec(), b"a".to_vec()]
        );
        assert!(decoder.push(b"abc").unwrap().is_empty());
        assert_eq!(decoder.push(b"\n").unwrap(), [b"abc".to_vec()]);
        assert_eq!(decoder.push(b"abcd\n"), Err(Error::FrameBudget));
        assert!(FrameDecoder::with_max_frame_bytes(0).push(b"a").is_err());
        assert!(FrameDecoder::with_max_frame_bytes(4).push(b"\r\n").is_err());
    }

    #[test]
    fn projects_tool_list_and_result_without_exposing_mcp_envelope() {
        let listed = Response {
            jsonrpc: "2.0".into(),
            id: 9,
            result: Some(
                json!({"tools":[{"name":"search","description":"Find papers","inputSchema":{"type":"object"}}]}),
            ),
            error: None,
        };
        let tools = decode_tools_list(listed).unwrap();
        assert_eq!(tools[0].name, "search");
        let result = Response {
            jsonrpc: "2.0".into(),
            id: 10,
            result: Some(
                json!({"content":[{"type":"text","text":"one"},{"type":"text","text":"two"}],"isError":false}),
            ),
            error: None,
        };
        assert_eq!(
            decode_tool_result(result).unwrap(),
            ToolResult {
                content: "one\ntwo".into(),
                is_error: false
            }
        );
        let structured_only = Response {
            jsonrpc: "2.0".into(),
            id: 11,
            result: Some(json!({
                "content": [],
                "structuredContent": {"echo":"structured"},
                "isError": false
            })),
            error: None,
        };
        assert_eq!(
            decode_tool_result(structured_only).unwrap(),
            ToolResult {
                content: r#"{"echo":"structured"}"#.into(),
                is_error: false
            }
        );
    }
}
