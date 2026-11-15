use super::*;

#[test]
fn original_candidate_fields_and_optional_evidence_round_trip_through_owned_contracts() {
    let value = serde_json::json!({
        "id":"candidate","runId":"run","providerId":"fixture","modelId":"model",
        "candidateKind":"reference_record_candidate_v1","schemaVersion":1,"currentRevision":1,
        "reviewState":"pending","validationStatus":"valid","originalPayloadHash":"original",
        "createdAt":"created","updatedAt":"updated",
        "evidenceBundle":{
            "id":"bundle","runId":"run","scopeHash":"scope","retrievalConfigVersion":"selection-anchor-v1",
            "validationStatus":"valid","createdAt":"created","items":[{
                "id":"evidence","citationKey":"ev-quote","ordinal":0,"anchorId":"anchor","paperId":"paper",
                "paperTitle":"Synthetic Ω","attachmentId":"attachment","contentSha256":"a".repeat(64),
                "pageIndex":0,"quoteExact":"Exact Ω","quotePrefix":"Before ","quoteSuffix":" after",
                "contextText":"Before Exact Ω after","relationKind":"direct_quote","validationStatus":"valid",
                "currentAnchorStatus":"valid","createdAt":"created"
            }]
        },
        "revisions":[{"id":"revision","revision":1,"payload":{"kind":"reference_record_candidate_v1"},"payloadHash":"payload","editorKind":"ai","changeReason":"generated","createdAt":"created"}],
        "decisions":[],"attentionFeedback":[],"suggestionItemDecisions":[],"citationAssessments":[],
        "inspectedEvidenceItemIds":[],"overviewFieldConfirmations":[],"summaryVersions":[]
    });
    let candidate: AiCandidate = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(candidate.evidence_bundle.items[0].page_label, None);
    assert_eq!(candidate.revisions[0].source_run_id, None);
    assert_eq!(candidate.revisions[0].parent_revision, None);
    assert_eq!(serde_json::to_value(&candidate).unwrap(), value);
    let observed = candidate.review_observation(1);
    assert_eq!(observed.current_editor_kind.as_deref(), Some("ai"));
    assert!(!observed.has_active_confirmations);
    assert!(!observed.has_revision_item_decisions);
    let encoded = crate::paper_context_wire::encode_payload(&candidate).unwrap();
    assert_eq!(
        crate::paper_context_wire::decode_payload::<AiCandidate>(&encoded).unwrap(),
        candidate
    );
    let draft = AiReviewDecisionDraft {
        candidate_id: "candidate".into(),
        candidate_revision: 1,
        action: "accept_unchanged".into(),
        rationale: "Reviewed Ω".into(),
        idempotency_key: "review".into(),
        reading_unit_title: None,
        project_id: None,
    };
    assert_eq!(
        serde_json::to_value(&draft).unwrap(),
        serde_json::json!({"candidateId":"candidate","candidateRevision":1,"action":"accept_unchanged","rationale":"Reviewed Ω","idempotencyKey":"review","readingUnitTitle":null,"projectId":null})
    );
    assert_eq!(
        crate::paper_context_wire::decode_payload::<AiReviewDecisionDraft>(
            &crate::paper_context_wire::encode_payload(&draft).unwrap()
        )
        .unwrap(),
        draft
    );
    let mut history = candidate;
    let original = history.revisions[0].clone();
    history.revisions = (1..=128)
        .map(|revision| AiCandidateRevision {
            id: format!("revision-{revision}"),
            revision,
            payload: serde_json::json!({"text":"Synthetic historical payload. ".repeat(1000)}),
            ..original.clone()
        })
        .collect();
    history.current_revision = 128;
    let bounded = serde_json::to_string(&history.review_observation(128)).unwrap();
    assert!(bounded.len() < 500);
    assert!(!bounded.contains("historical payload"));
    assert_eq!(history.revisions.len(), 128);
}
