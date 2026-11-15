//! Original generated-candidate policy at its lazy Core fact-read boundaries.
use crate::{
    candidate_contracts::{
        AiOverviewProfileContext, CandidatePayload, CandidateValidationError, EvidenceQuote,
    },
    generation::AiMatrixSynthesisContext,
    paper_context_wire::decode_payload,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CandidateInputV1 {
    Decode {
        content: String,
        evidence_keys: Vec<String>,
    },
    KindAndQuotes {
        payload_cbor_base64: String,
        task_kind: String,
        suggestion_kind: Option<String>,
        evidence: Vec<EvidenceQuote>,
    },
    Profile {
        payload_cbor_base64: String,
        profile: Option<AiOverviewProfileContext>,
    },
    Finalize {
        payload_cbor_base64: String,
        matrix: Option<AiMatrixSynthesisContext>,
    },
    RevisionQuotesAndKind {
        payload_cbor_base64: String,
        candidate_kind: String,
        evidence: Vec<EvidenceQuote>,
    },
    RevisionMatrix {
        payload_cbor_base64: String,
        matrix: Option<AiMatrixSynthesisContext>,
    },
    RevisionConfirmedFields {
        payload_cbor_base64: String,
        active_fields: Vec<(String, String)>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CandidateDecisionV1 {
    Decoded { payload_cbor_base64: String },
    Validated {},
    Prepared { canonical_json: String },
    Rejected { error: CandidateValidationError },
}

impl CandidateInputV1 {
    pub fn matches_decision(&self, decision: &CandidateDecisionV1) -> bool {
        match (self, decision) {
            (_, CandidateDecisionV1::Rejected { .. }) => true,
            (
                Self::Decode { .. },
                CandidateDecisionV1::Decoded {
                    payload_cbor_base64,
                },
            ) => decode_payload::<CandidatePayload>(payload_cbor_base64).is_ok(),
            (
                Self::KindAndQuotes { .. }
                | Self::Profile { .. }
                | Self::RevisionQuotesAndKind { .. }
                | Self::RevisionMatrix { .. },
                CandidateDecisionV1::Validated {},
            ) => true,
            (
                Self::Finalize {
                    payload_cbor_base64,
                    ..
                }
                | Self::RevisionConfirmedFields {
                    payload_cbor_base64,
                    ..
                },
                CandidateDecisionV1::Prepared { canonical_json },
            ) => {
                match (
                    decode_payload::<CandidatePayload>(payload_cbor_base64),
                    serde_json::from_str::<serde_json::Value>(canonical_json),
                ) {
                    (Ok(payload), Ok(value)) => value["kind"].as_str() == Some(payload.kind()),
                    _ => false,
                }
            }
            _ => false,
        }
    }
}
