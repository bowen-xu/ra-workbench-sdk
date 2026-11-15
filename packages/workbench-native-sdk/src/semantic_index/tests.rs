use super::*;
use std::cell::RefCell;

fn decode(
    namespace: &str,
    dimension: i64,
    invalid_path: bool,
) -> (Result<PendingEmbeddingJob, &'static str>, Vec<usize>) {
    let calls = RefCell::new(Vec::new());
    let result = decode_pending_job(
        |index| {
            calls.borrow_mut().push(index);
            if index == 2 {
                return Ok(namespace.into());
            }
            if index == 3 && invalid_path {
                return Err("path column conversion");
            }
            Ok(format!("field-{index}"))
        },
        |index| {
            calls.borrow_mut().push(index);
            Ok(match index {
                4 => dimension,
                14 => 7,
                9 => 11,
                _ => panic!("unexpected integer column {index}"),
            })
        },
        |message| message,
    );
    (result, calls.into_inner())
}

#[test]
fn owned_job_preserves_original_field_order_and_all_namespace_contracts() {
    for namespace in [
        "accepted_concepts",
        "candidate_staging",
        "definition_claims",
        "source_passages",
    ] {
        let (result, calls) = decode(namespace, 0, false);
        let job = result.unwrap();
        assert_eq!(job.namespace.table_name(), namespace);
        assert_eq!(
            job.dimension, 0,
            "stored decoding adds no dimension minimum"
        );
        assert_eq!(job.row.generation, 7);
        assert_eq!(job.row.subject_revision, 11);
        assert!(job.row.vector.is_empty());
        assert_eq!(
            calls,
            [
                2, 4, 14, 0, 1, 3, 16, 17, 18, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15
            ]
        );
        assert_eq!(serde_json::to_value(job.namespace).unwrap(), namespace);
    }
}

#[test]
fn namespace_rejection_precedes_later_path_conversion() {
    let (result, calls) = decode("unknown", -1, true);
    assert_eq!(result.unwrap_err(), "语义索引 namespace 无效");
    assert_eq!(calls, [2, 4, 14, 0, 1]);
}

#[test]
fn path_conversion_precedes_dimension_rejection_and_later_metadata() {
    let (result, calls) = decode("accepted_concepts", -1, true);
    assert_eq!(result.unwrap_err(), "path column conversion");
    assert_eq!(calls, [2, 4, 14, 0, 1, 3]);
    let (result, calls) = decode("accepted_concepts", -1, false);
    assert_eq!(result.unwrap_err(), "向量维度无效");
    assert_eq!(calls, [2, 4, 14, 0, 1, 3]);
}

#[test]
fn original_index_command_dtos_keep_their_json_keys_and_optional_omissions() {
    use serde_json::json;
    let job = EmbeddingJobSummary {
        job_id: "job".into(),
        representation_id: "representation".into(),
        subject_kind: "concept".into(),
        subject_id: "concept".into(),
        status: "queued".into(),
        attempt: 1,
        error_code: None,
        created_at: "created".into(),
        finished_at: None,
    };
    let expected = json!({"jobId":"job","representationId":"representation","subjectKind":"concept","subjectId":"concept","status":"queued","attempt":1,"createdAt":"created"});
    assert_eq!(serde_json::to_value(&job).unwrap(), expected);
    assert_eq!(
        serde_json::from_value::<EmbeddingJobSummary>(expected).unwrap(),
        job
    );
    assert_eq!(
        serde_json::to_value(SemanticIndexStatus {
            spaces: Vec::new(),
            running_job_ids: Vec::new(),
            reconciliation_required: false
        })
        .unwrap(),
        json!({"spaces":[],"runningJobIds":[],"reconciliationRequired":false})
    );
    let space = SemanticIndexSpaceStatus {
        embedding_space_id: "space".into(),
        provider_id: "provider".into(),
        model_id: "model".into(),
        model_revision: "revision".into(),
        dimension: 1024,
        generation: 2,
        generation_status: "building".into(),
        namespace: "accepted_concepts".into(),
        ready_count: 1,
        pending_count: 2,
        failed_count: 3,
        stale_count: 4,
    };
    assert_eq!(
        serde_json::to_value(space).unwrap(),
        json!({"embeddingSpaceId":"space","providerId":"provider","modelId":"model","modelRevision":"revision","dimension":1024,"generation":2,"generationStatus":"building","namespace":"accepted_concepts","readyCount":1,"pendingCount":2,"failedCount":3,"staleCount":4})
    );
    let generation = IndexGenerationSummary {
        generation_id: "generation".into(),
        embedding_space_id: "space".into(),
        namespace: "accepted_concepts".into(),
        generation: 2,
        status: "building".into(),
        record_count: 3,
        ready_count: 1,
        created_at: "created".into(),
        activated_at: None,
    };
    assert_eq!(
        serde_json::to_value(generation).unwrap(),
        json!({"generationId":"generation","embeddingSpaceId":"space","namespace":"accepted_concepts","generation":2,"status":"building","recordCount":3,"readyCount":1,"createdAt":"created"})
    );
    let reconciliation = ReconciliationSummary {
        run_id: "run".into(),
        status: "running".into(),
        checked_count: 1,
        missing_count: 2,
        orphan_count: 3,
        repaired_count: 4,
        error_code: None,
        started_at: "started".into(),
        finished_at: None,
    };
    assert_eq!(
        serde_json::to_value(reconciliation).unwrap(),
        json!({"runId":"run","status":"running","checkedCount":1,"missingCount":2,"orphanCount":3,"repairedCount":4,"startedAt":"started"})
    );
}

#[test]
fn finite_index_results_bind_job_scope_cas_and_physical_receipt_facts() {
    use rules::{
        IndexDecisionV1 as Decision, IndexInputV1 as Input, ReconcileActionV1 as Action,
        StoredIndexRowV1,
    };
    let job = EmbeddingJobSummary {
        job_id: "job".into(),
        representation_id: "representation".into(),
        subject_kind: "concept".into(),
        subject_id: "concept".into(),
        status: "queued".into(),
        attempt: 1,
        error_code: None,
        created_at: "created".into(),
        finished_at: None,
    };
    let retry = Input::Retry {
        record_status: "queued".into(),
        latest: Some(job.clone()),
    };
    assert!(
        Decision::ReuseJob {
            summary: job.clone(),
            should_start: true
        }
        .matches_input(&retry)
    );
    assert!(
        !Decision::ReuseJob {
            summary: job.clone(),
            should_start: false
        }
        .matches_input(&retry)
    );
    let mut outside = job;
    outside.job_id = "outside".into();
    assert!(
        !Decision::ReuseJob {
            summary: outside,
            should_start: true
        }
        .matches_input(&retry)
    );
    assert!(!Decision::Validated.matches_input(&retry));
    assert!(Decision::QueueJob.matches_input(&retry));
    for changed in [0, 1, 2] {
        assert_eq!(
            Decision::Validated.matches_input(&Input::Running { changed }),
            changed == 1
        );
        assert_eq!(
            Decision::Validated.matches_input(&Input::Ready { changed }),
            changed == 1
        );
    }
    assert!(!Decision::Validated.matches_input(&Input::Space { exists: false }));
    let record = ReconciliationRecord {
        record_id: "record".into(),
        representation_id: "representation".into(),
        lance_row_id: "row".into(),
        input_sha256: "expected".into(),
        status: "running".into(),
    };
    let input = Input::ReconcileRecord {
        record,
        stored: Some(StoredIndexRowV1 {
            input_sha256: "expected".into(),
            dataset_version: u64::MAX,
            vector_norm_bits: 0x7fc0_1234,
        }),
    };
    for (version, norm, expected) in [
        (u64::MAX, 0x7fc0_1234, true),
        (1, 0x7fc0_1234, false),
        (u64::MAX, 0x7fc0_1235, false),
    ] {
        assert_eq!(
            Decision::Reconcile {
                action: Action::Complete {
                    dataset_version: version,
                    vector_norm_bits: norm
                }
            }
            .matches_input(&input),
            expected
        );
    }
    let mut different = input;
    let Input::ReconcileRecord { stored, .. } = &mut different else {
        unreachable!()
    };
    stored.as_mut().unwrap().input_sha256 = "different".into();
    assert!(
        !Decision::Reconcile {
            action: Action::Complete {
                dataset_version: u64::MAX,
                vector_norm_bits: 0x7fc0_1234
            }
        }
        .matches_input(&different)
    );
}
