//! Original field and paper review operations over owned observations.
pub mod contracts;
pub mod field;
pub mod overview;
pub mod unit;
pub mod wire;

use contracts::{
    AiOverviewConfirmationUndoDraft, AiOverviewFieldConfirmationDraft,
    AiPaperReviewConfirmationDraft, AiPaperReviewConfirmationUndoDraft,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperConfirmationRequestV1 {
    ConfirmOverview {
        draft: AiOverviewFieldConfirmationDraft,
    },
    UndoOverview {
        draft: AiOverviewConfirmationUndoDraft,
    },
    ConfirmPaper {
        draft: AiPaperReviewConfirmationDraft,
    },
    UndoPaper {
        draft: AiPaperReviewConfirmationUndoDraft,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn original_confirmation_drafts_keep_fields_and_unknown_field_compatibility() {
        let values = [
            json!({"kind":"confirmOverview","draft":{"candidateId":"candidate","candidateRevision":3,"fieldKinds":["research_question"],"scopeKind":"field","projectId":null,"idempotencyKey":"key","legacyExtra":"ignored"}}),
            json!({"kind":"undoOverview","draft":{"batchId":"batch","idempotencyKey":"undo","fieldKind":"research_question"}}),
            json!({"kind":"confirmPaper","draft":{"paperId":"paper","projectId":"project","metadataFieldNames":["title"],"overviewTargets":[{"candidateId":"candidate","candidateRevision":3,"fieldKinds":["research_question"]}],"idempotencyKey":"paper-key"}}),
            json!({"kind":"undoPaper","draft":{"batchId":"batch","idempotencyKey":"undo-paper"}}),
        ];
        for value in values {
            let request: PaperConfirmationRequestV1 = serde_json::from_value(value).unwrap();
            let encoded = serde_json::to_value(&request).unwrap();
            assert_eq!(
                serde_json::from_value::<PaperConfirmationRequestV1>(encoded.clone()).unwrap(),
                request
            );
            assert!(encoded["draft"].get("legacyExtra").is_none());
        }
        assert!(
            serde_json::from_value::<PaperConfirmationRequestV1>(json!({
                "kind":"undoPaper", "draft":{"batchId":"batch","idempotencyKey":"key"},
                "sql":"arbitrary execution"
            }))
            .is_err()
        );
    }

    #[test]
    fn original_batch_output_keeps_camel_case_and_optional_omissions() {
        let batch = contracts::AiOverviewConfirmationBatch {
            id: "batch".into(),
            candidate_id: "candidate".into(),
            candidate_revision: 3,
            scope_kind: "field".into(),
            paper_id: "paper".into(),
            project_id: None,
            idempotency_key: "key".into(),
            created_at: "created".into(),
            field_confirmations: vec![],
            active: true,
            undone_at: None,
        };
        assert_eq!(
            serde_json::to_value(batch).unwrap(),
            json!({
                "id":"batch", "candidateId":"candidate", "candidateRevision":3,
                "scopeKind":"field", "paperId":"paper", "idempotencyKey":"key",
                "createdAt":"created", "fieldConfirmations":[], "active":true
            })
        );
    }
}
