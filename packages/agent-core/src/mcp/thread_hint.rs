//! Text selection from pinned Codex session/mod.rs::build_initial_context,
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b, Apache-2.0, Copyright 2025 OpenAI.
use super::*;

/// Optional host memory uses only nonempty text blocks. Structured/image data
/// must not become developer prose through the generic tool-result renderer.
pub fn decode_thread_hint(response: Response) -> Result<Option<String>, Error> {
    validate_response(&response)?;
    if response.error.is_some() {
        return Err(Error::InvalidTools);
    }
    let result = response.result.ok_or(Error::InvalidTools)?;
    let Some(blocks) = result.get("content").and_then(Value::as_array) else {
        return Ok(None);
    };
    let mut text = String::new();
    for block in blocks {
        let Some(body) = block
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        else {
            continue;
        };
        let separator = usize::from(!text.is_empty());
        if text
            .len()
            .checked_add(separator)
            .and_then(|size| size.checked_add(body.len()))
            .is_none_or(|size| size > MAX_TOOL_RESULT_BYTES)
        {
            return Err(Error::ToolBudget);
        }
        if separator != 0 {
            text.push('\n');
        }
        text.push_str(body);
    }
    Ok((!text.is_empty()).then_some(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn response(result: Value) -> Response {
        Response {
            jsonrpc: "2.0".into(),
            id: 1,
            result: Some(result),
            error: None,
        }
    }
    #[test]
    fn selects_only_text_preserving_order_and_whitespace() {
        assert_eq!(decode_thread_hint(response(json!({"content":[{"text":""},{"text":"  note  "},{"type":"image","data":"ignored"},{"text":"anchor"}],"structuredContent":{"private":"ignored"}}))).unwrap(), Some("  note  \nanchor".into()));
        assert_eq!(
            decode_thread_hint(response(
                json!({"content":[],"structuredContent":{"text":"not a block"}})
            ))
            .unwrap(),
            None
        );
    }
    #[test]
    fn oversize_and_rpc_failure_do_not_produce_partial_hints() {
        assert_eq!(
            decode_thread_hint(response(
                json!({"content":[{"text":"x".repeat(MAX_TOOL_RESULT_BYTES+1)}]})
            )),
            Err(Error::ToolBudget)
        );
        let failed = Response {
            jsonrpc: "2.0".into(),
            id: 1,
            result: None,
            error: Some(ErrorObject {
                code: -1,
                message: "failed".into(),
            }),
        };
        assert!(decode_thread_hint(failed).is_err());
    }
}
