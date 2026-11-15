//! Finite paper-scoped trace decision. Core retains scope ownership and SQL.
use crate::{literature_trace_protocol::TraceDecision, retrieval_trace::RetrievalTraceRow};
use serde::{Deserialize, Deserializer, Serialize};

pub const CAPABILITY_ID: &str = "literature.paper-retrieval-trace";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperRetrievalInputV1 {
    pub paper_id: String,
    pub query: String,
    #[serde(deserialize_with = "required_row")]
    pub row: Option<RetrievalTraceRow>,
}

fn required_row<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<RetrievalTraceRow>, D::Error> {
    Option::deserialize(deserializer)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperRetrievalOutcomeV1 {
    pub input: Box<PaperRetrievalInputV1>,
    pub decision: TraceDecision,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{CatalogInput, CatalogOperation, CatalogOutput};
    use crate::retrieval_trace::TraceRejection;
    use serde_json::json;

    #[test]
    fn paper_scope_is_explicit_and_nullable_observation_is_required() {
        let wire = json!({"paperId":" raw-paper ","query":" \tquestion Ω\u{0} ","row":null});
        let input: PaperRetrievalInputV1 = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(&input).unwrap(), wire);
        let request = CatalogInput::DecidePaperRetrievalTrace {
            input: Box::new(input.clone()),
        };
        assert_eq!(
            request.operation(),
            CatalogOperation::DecidePaperRetrievalTrace
        );
        let response = CatalogOutput::PaperRetrievalTrace {
            outcome: Box::new(PaperRetrievalOutcomeV1 {
                input: Box::new(input),
                decision: TraceDecision::Rejected {
                    reason: TraceRejection::NotFound,
                },
            }),
        };
        assert_eq!(response.operation(), request.operation());
        for key in ["paperId", "query", "row"] {
            let mut invalid = wire.clone();
            invalid.as_object_mut().unwrap().remove(key);
            assert!(serde_json::from_value::<PaperRetrievalInputV1>(invalid).is_err());
        }
        let mut invalid = wire;
        invalid["sql"] = json!("not an execution grant");
        assert!(serde_json::from_value::<PaperRetrievalInputV1>(invalid).is_err());
    }
}
