//! Original owned foundation rows and pure computation boundary.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoundationIdentity {
    pub revision: i64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperFoundations {
    pub title: String,
    pub concepts: BTreeMap<String, FoundationIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoundationInputV1 {
    pub paper_ids: Vec<String>,
    pub papers: BTreeMap<String, PaperFoundations>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FoundationRejectionV1 {
    NotFound,
    InvalidInput { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        knowledge_promotion::{
            KnowledgeValidationDecisionV1 as Decision, KnowledgeValidationInputV1 as Input,
        },
        paper_context_wire::{decode_payload, encode_payload},
    };

    #[test]
    fn original_graph_and_encoded_result_keep_exact_types() {
        let graph = FoundationInputV1 {
            paper_ids: vec!["left".into(), "right".into()],
            papers: BTreeMap::from([(
                "left".into(),
                PaperFoundations {
                    title: "Title Ω".into(),
                    concepts: BTreeMap::from([(
                        "concept".into(),
                        FoundationIdentity {
                            revision: 3,
                            label: "Label Ω".into(),
                        },
                    )]),
                },
            )]),
        };
        assert_eq!(
            decode_payload::<FoundationInputV1>(&encode_payload(&graph).unwrap()).unwrap(),
            graph
        );
        let input = Input::FoundationComparison {
            input: Box::new(graph),
        };
        let result: Result<
            Vec<super::super::algorithms::PaperFoundationSimilarity>,
            FoundationRejectionV1,
        > = Err(FoundationRejectionV1::NotFound);
        assert!(input.matches_decision(&Decision::FoundationComparison {
            result: Ok(encode_payload(&result).unwrap())
        }));
        assert!(!input.matches_decision(&Decision::FoundationComparison {
            result: Ok(encode_payload(&vec!["invalid row"]).unwrap())
        }));
        assert!(!input.matches_decision(&Decision::Checked { rejection: None }));
    }
}
