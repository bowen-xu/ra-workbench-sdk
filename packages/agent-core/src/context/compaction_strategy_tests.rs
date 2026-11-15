use super::*;
use serde_json::json;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

struct Strategy {
    binding: CompactionBinding,
    result: Mutex<Option<Result<CompactionCandidate, CompactionFailure>>>,
    calls: AtomicUsize,
}
impl CompactionStrategy for Strategy {
    fn binding(&self) -> CompactionBinding {
        self.binding.clone()
    }
    fn validate_output(&self, output: &CompactionOutput) -> Result<(), CompactionFailure> {
        let is_item = |item: &Value| {
            item.get("type").and_then(Value::as_str) == Some("compaction")
                && item.get("encrypted_content").is_some_and(Value::is_string)
        };
        let valid = match output {
            CompactionOutput::ResetWindow => false,
            CompactionOutput::TextSummary(text) => !text.trim().is_empty(),
            CompactionOutput::RemoteOpaque(item) => is_item(item),
            CompactionOutput::RemoteWindow(items) => {
                items.iter().filter(|item| is_item(item)).count() == 1
                    && items
                        .iter()
                        .filter(|item| {
                            item.get("type").and_then(Value::as_str) == Some("compaction")
                        })
                        .count()
                        == 1
            }
        };
        if valid {
            Ok(())
        } else {
            Err(CompactionFailure::InvalidOutput)
        }
    }
    fn compact(&self, request: CompactionRequest) -> CompactionFuture<'_, CompactionCandidate> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        assert_eq!(request.source.messages.len(), 1);
        Box::pin(async { self.result.lock().unwrap().take().unwrap() })
    }
}
fn request(kind: CompactionKind) -> CompactionRequest {
    let model = ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "model".into(),
        revision: Some("v1".into()),
    };
    CompactionRequest {
        operation_id: Uuid::from_u128(1),
        conversation_id: Uuid::from_u128(2),
        turn_id: Uuid::from_u128(3),
        history_revision: 7,
        phase: CompactionPhase::MidTurn,
        binding: CompactionBinding {
            model: model.clone(),
            strategy_id: "fixture.strategy".into(),
            state_schema: 1,
            kind,
        },
        source: ModelRequest {
            captured_history: None,
            request_id: Uuid::from_u128(4),
            model,
            messages: vec![ModelMessage::User {
                content: vec![ContentPart::Text("evidence".into())],
                source_item_id: None,
            }],
            tools: vec![],
            max_output_tokens: 100,
            parallel_tool_calls: false,
            reasoning_effort: None,
        },
        max_result_bytes: 1024,
    }
}

#[test]
fn default_read_compatibility_never_infers_portability() {
    for kind in [
        CompactionKind::TextSummary,
        CompactionKind::RemoteOpaque,
        CompactionKind::RemoteWindow,
    ] {
        let request = request(kind);
        let strategy = strategy(&request, CompactionOutput::TextSummary("unused".into()));
        assert!(strategy.accepts_binding(&request.binding));
        let mut other = request.binding.clone();
        other.model.revision = Some("v2".into());
        assert!(!strategy.accepts_binding(&other));
        other = request.binding.clone();
        other.model.provider_id = "other".into();
        assert!(!strategy.accepts_binding(&other));
        other = request.binding.clone();
        other.model.model_id = "other".into();
        assert!(!strategy.accepts_binding(&other));
    }
}
fn strategy(request: &CompactionRequest, output: CompactionOutput) -> Strategy {
    Strategy {
        binding: request.binding.clone(),
        result: Mutex::new(Some(Ok(CompactionCandidate {
            binding: request.binding.clone(),
            credential_scope_id: (request.binding.kind != CompactionKind::TextSummary)
                .then_some(Uuid::from_u128(5)),
            output,
            usage: ModelUsage::default(),
            response_id: None,
        }))),
        calls: AtomicUsize::new(0),
    }
}
fn opaque() -> Value {
    json!({"type":"compaction", "id":"cmp_fixture", "encrypted_content":"opaque", "provider_metadata":{"version":2}})
}

#[tokio::test]
async fn candidates_require_the_account_contract_of_the_selected_strategy() {
    for (kind, output, scope) in [
        (
            CompactionKind::RemoteOpaque,
            CompactionOutput::RemoteOpaque(opaque()),
            None,
        ),
        (
            CompactionKind::RemoteOpaque,
            CompactionOutput::RemoteOpaque(opaque()),
            Some(Uuid::nil()),
        ),
        (
            CompactionKind::RemoteWindow,
            CompactionOutput::RemoteWindow(vec![opaque()]),
            None,
        ),
        (
            CompactionKind::RemoteWindow,
            CompactionOutput::RemoteWindow(vec![opaque()]),
            Some(Uuid::nil()),
        ),
        (
            CompactionKind::TextSummary,
            CompactionOutput::TextSummary("summary".into()),
            Some(Uuid::from_u128(5)),
        ),
    ] {
        let request = request(kind);
        let strategy = strategy(&request, output);
        strategy
            .result
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .as_mut()
            .unwrap()
            .credential_scope_id = scope;
        assert!(matches!(
            prepare_compaction(&strategy, request).await,
            Err(CompactionFailure::Incompatible)
        ));
    }
}

#[tokio::test]
async fn supplier_validation_accepts_its_own_opaque_protocol() {
    struct VendorStrategy(CompactionBinding);
    impl CompactionStrategy for VendorStrategy {
        fn binding(&self) -> CompactionBinding {
            self.0.clone()
        }
        fn validate_output(&self, output: &CompactionOutput) -> Result<(), CompactionFailure> {
            match output {
                CompactionOutput::RemoteOpaque(item)
                    if item.get("type").and_then(Value::as_str) == Some("vendor_memory")
                        && item.get("state").is_some_and(Value::is_string) =>
                {
                    Ok(())
                }
                _ => Err(CompactionFailure::InvalidOutput),
            }
        }
        fn compact(&self, _: CompactionRequest) -> CompactionFuture<'_, CompactionCandidate> {
            Box::pin(async {
                Ok(CompactionCandidate {
                    binding: self.0.clone(),
                    credential_scope_id: Some(Uuid::from_u128(5)),
                    output: CompactionOutput::RemoteOpaque(
                        json!({"type":"vendor_memory", "state":"opaque"}),
                    ),
                    usage: ModelUsage::default(),
                    response_id: None,
                })
            })
        }
    }
    let request = request(CompactionKind::RemoteOpaque);
    let candidate = prepare_compaction(&VendorStrategy(request.binding.clone()), request)
        .await
        .unwrap();
    assert!(
        matches!(candidate.output, CompactionOutput::RemoteOpaque(item) if item["type"] == "vendor_memory")
    );
}

#[tokio::test]
async fn rejects_model_revision_and_provider_mismatch_before_io() {
    let request = request(CompactionKind::TextSummary);
    let mut strategy = strategy(&request, CompactionOutput::TextSummary("summary".into()));
    strategy.binding.model.revision = Some("v2".into());
    assert!(matches!(
        prepare_compaction(&strategy, request.clone()).await,
        Err(CompactionFailure::Incompatible)
    ));
    assert_eq!(strategy.calls.load(Ordering::SeqCst), 0);
    strategy.binding = request.binding.clone();
    strategy.binding.model.provider_id = "another".into();
    assert!(matches!(
        prepare_compaction(&strategy, request).await,
        Err(CompactionFailure::Incompatible)
    ));
    assert_eq!(strategy.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn preserves_opaque_item_and_complete_window_without_normalizing_payload() {
    let request = request(CompactionKind::RemoteOpaque);
    let output = CompactionOutput::RemoteOpaque(opaque());
    let strategy = strategy(&request, output.clone());
    let candidate = prepare_compaction(&strategy, request).await.unwrap();
    assert!(candidate.output == output);
    let request = super::tests::request(CompactionKind::RemoteWindow);
    let output = CompactionOutput::RemoteWindow(vec![
        json!({"type":"message", "role":"user", "content":"keep"}),
        opaque(),
    ]);
    let strategy = super::tests::strategy(&request, output.clone());
    assert!(prepare_compaction(&strategy, request).await.unwrap().output == output);
}

#[tokio::test]
async fn empty_provider_window_shape_does_not_override_supplier_validation() {
    let output = CompactionOutput::RemoteWindow(vec![]);
    validate_output(&output, CompactionKind::RemoteWindow, 1024).unwrap();
    let request = request(CompactionKind::RemoteWindow);
    // This injected supplier requires one compaction item. The generic empty
    // window contract must not bypass its stricter policy.
    let strategy = strategy(&request, output);
    assert!(matches!(
        prepare_compaction(&strategy, request).await,
        Err(CompactionFailure::InvalidOutput)
    ));
}

#[tokio::test]
async fn rejects_empty_summary_wrong_kind_and_multiple_compaction_items() {
    for (kind, output) in [
        (
            CompactionKind::TextSummary,
            CompactionOutput::TextSummary(" \n".into()),
        ),
        (
            CompactionKind::TextSummary,
            CompactionOutput::RemoteOpaque(opaque()),
        ),
        (
            CompactionKind::RemoteOpaque,
            CompactionOutput::RemoteOpaque(json!({"type":"message","content":"opaque"})),
        ),
        (
            CompactionKind::RemoteWindow,
            CompactionOutput::RemoteWindow(vec![opaque(), opaque()]),
        ),
    ] {
        let request = request(kind);
        let strategy = strategy(&request, output);
        assert!(matches!(
            prepare_compaction(&strategy, request).await,
            Err(CompactionFailure::InvalidOutput)
        ));
    }
}

#[tokio::test]
async fn failure_is_not_a_successful_truncation_candidate() {
    let request = request(CompactionKind::TextSummary);
    let strategy = strategy(&request, CompactionOutput::TextSummary("summary".into()));
    *strategy.result.lock().unwrap() = Some(Err(ModelError::IncompleteStream.into()));
    assert!(matches!(
        prepare_compaction(&strategy, request).await,
        Err(CompactionFailure::Model(ModelError::IncompleteStream))
    ));
}

#[tokio::test]
async fn enforces_persisted_bytes_without_truncating_the_returned_state() {
    let mut request = request(CompactionKind::RemoteOpaque);
    request.max_result_bytes = 32;
    let strategy = strategy(&request, CompactionOutput::RemoteOpaque(opaque()));
    assert!(matches!(
        prepare_compaction(&strategy, request).await,
        Err(CompactionFailure::OutputBudget)
    ));
}

#[test]
fn trigger_and_effective_window_do_not_subtract_output_limit() {
    let budget = CompactionBudget {
        context_window_tokens: 1000,
        effective_percent: 95,
        configured_trigger_tokens: Some(999),
        output_reserve_tokens: 100,
    };
    assert_eq!(budget.limits().unwrap(), (900, 950));
    assert!(!budget.should_compact(899).unwrap());
    assert!(budget.should_compact(900).unwrap());
    assert_eq!(
        CompactionBudget {
            output_reserve_tokens: 0,
            ..budget
        }
        .limits()
        .unwrap(),
        (900, 950)
    );
    assert_eq!(
        CompactionBudget {
            output_reserve_tokens: 950,
            ..budget
        }
        .limits()
        .unwrap(),
        (900, 950)
    );
    assert!(
        CompactionBudget {
            effective_percent: 80,
            ..budget
        }
        .should_compact(800)
        .unwrap()
    );
    assert_eq!(
        CompactionBudget {
            context_window_tokens: u64::MAX,
            output_reserve_tokens: 0,
            ..budget
        }
        .limits()
        .unwrap()
        .0,
        999
    );
}

#[test]
fn post_compact_continuation_precedes_steer_and_manual_tasks_never_drain_it() {
    assert!(!drain_steer_after_compaction(
        CompactionPhase::Manual,
        false
    ));
    assert!(!drain_steer_after_compaction(
        CompactionPhase::MidTurn,
        true
    ));
    assert!(drain_steer_after_compaction(
        CompactionPhase::MidTurn,
        false
    ));
    assert!(!drain_steer_after_compaction(
        CompactionPhase::PreTurn,
        false
    ));
}

#[tokio::test]
async fn reset_is_exact_model_bound_without_usage_receipt_or_summary() {
    use crate::context::token_budget::reset::TokenBudgetResetStrategy;
    let mut request = request(CompactionKind::ResetWindow);
    let strategy = TokenBudgetResetStrategy::new(request.source.model.clone()).unwrap();
    request.binding = strategy.binding();
    let candidate = prepare_compaction(&strategy, request.clone())
        .await
        .unwrap();
    assert!(candidate.output == CompactionOutput::ResetWindow);
    assert!(candidate.credential_scope_id.is_none());
    assert!(candidate.response_id.is_none());
    assert_eq!(candidate.usage, ModelUsage::default());
    assert!(strategy.retention_policy() == Some(CompactionRetention::ResetWindow));
    assert!(
        strategy
            .validate_output(&CompactionOutput::TextSummary(String::new()))
            .is_err()
    );
    request.source.model.revision = Some("different-revision".into());
    assert!(matches!(
        prepare_compaction(&strategy, request).await,
        Err(CompactionFailure::Incompatible)
    ));
}
