//! Request-scoped retry boundary adapted from Apache-2.0 Codex
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b core/src/session/turn.rs::run_sampling_request
//! and responses_retry.rs. Copyright 2025 OpenAI.
//! Retry from completed history, including after visible partial text. The failed
//! draft stays in the journal, never in the next request or executable tool batch.
use super::*;

impl TurnRunner<'_> {
    pub(super) async fn retry_model_failure(
        &self,
        turn_id: Uuid,
        attempt_id: Uuid,
        error: ModelError,
        failed_attempts: &mut u8,
        retry_wait: &dyn RetryWait,
        retry_allowed: bool,
    ) -> Result<(), RunError> {
        *failed_attempts = failed_attempts.saturating_add(1);
        let decision = if retry_allowed {
            RetryPolicy::DEFAULT.decide(error, *failed_attempts)
        } else {
            RetryDecision::Stop
        };
        self.sink
            .emit(EventPayload::ModelRequestFailed {
                turn_id,
                attempt_id,
                error: error.to_string(),
                retryable: matches!(decision, RetryDecision::Retry { .. }),
                category: Some(error.into()),
            })
            .await?;
        match decision {
            RetryDecision::Retry { delay_ms } => retry_wait.wait(delay_ms).await,
            RetryDecision::Stop => Err(error.into()),
        }
    }
}
