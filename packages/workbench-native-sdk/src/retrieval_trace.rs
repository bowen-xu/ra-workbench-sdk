//! Observed trace data only; scope ownership, SQL time and consumption stay out.
use serde::{Deserialize, Serialize};

/// Frozen postcondition of the original conditional trace-consumption UPDATE.
pub const MARK_SENT_EXPECTED_ROWS: u64 = 1;
pub const MARK_SENT_REJECTION: TraceRejection = TraceRejection::AlreadyConsumed;

/// Domain rejections are data, not a Core context, SQL command or receipt.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceRejection {
    NotFound,
    QueryMismatch,
    AlreadyConsumed,
    Expired,
    ContextHashMismatch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkSentCondition {
    pub expected_rows: u64,
    pub on_mismatch: TraceRejection,
}

impl MarkSentCondition {
    pub const ORIGINAL: Self = Self {
        expected_rows: MARK_SENT_EXPECTED_ROWS,
        on_mismatch: MARK_SENT_REJECTION,
    };
}

/// The six values returned by the original trace read, including SQL expiry.
/// `paper_id: None` is the original global scope, not an inferred host scope.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetrievalTraceRow {
    pub paper_id: Option<String>,
    pub query_sha256: String,
    pub status: String,
    pub context_text: String,
    pub context_sha256: String,
    pub expired: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trace_row_codec_keeps_the_exact_six_camel_case_fields_and_raw_bytes() {
        for paper_id in [None, Some(" raw-paper ".into()), Some(String::new())] {
            let row = RetrievalTraceRow {
                paper_id: paper_id.clone(),
                query_sha256: "OriginalHASH".into(),
                status: "original-status".into(),
                context_text: " \t[CN-S1] 原文\n".into(),
                context_sha256: "OriginalContextHASH".into(),
                expired: false,
            };
            let wire = json!({
                "paperId":paper_id,
                "querySha256":"OriginalHASH",
                "status":"original-status",
                "contextText":" \t[CN-S1] 原文\n",
                "contextSha256":"OriginalContextHASH",
                "expired":false,
            });
            assert_eq!(serde_json::to_value(&row).unwrap(), wire);
            assert_eq!(
                serde_json::from_value::<RetrievalTraceRow>(wire).unwrap(),
                row
            );
        }
    }

    #[test]
    fn trace_row_codec_rejects_extra_authority_and_wrongly_typed_observations() {
        let original = json!({"paperId":null,"querySha256":"q","status":"previewed","contextText":"context","contextSha256":"c","expired":true});
        for (field, value) in [
            ("sql", json!("select private_data")),
            ("transaction", json!("no")),
            ("paperId", json!(42)),
            ("querySha256", json!(null)),
            ("contextText", json!(null)),
            ("expired", json!(1)),
            ("status", json!(true)),
        ] {
            let mut invalid = original.clone();
            invalid[field] = value;
            assert!(
                serde_json::from_value::<RetrievalTraceRow>(invalid).is_err(),
                "{field}"
            );
        }
        let mut missing = original;
        missing.as_object_mut().unwrap().remove("expired");
        assert!(serde_json::from_value::<RetrievalTraceRow>(missing).is_err());
    }
}
