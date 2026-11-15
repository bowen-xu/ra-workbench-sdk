//! Retry and backoff policy adapted from Codex model/session retry handling.
//! The policy never retries a tool side effect: it only applies to a model
//! request that produced no executable tool call.

use crate::model::ModelError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: u8,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetryDecision {
    Retry { delay_ms: u64 },
    Stop,
}

impl RetryPolicy {
    pub const DEFAULT: Self = Self {
        max_attempts: 6, // Initial request plus at most five reconnects.
        base_delay_ms: 250,
        max_delay_ms: 8_000,
    };

    pub fn decide(self, error: ModelError, completed_attempts: u8) -> RetryDecision {
        if completed_attempts >= self.max_attempts || !retryable(error) {
            return RetryDecision::Stop;
        }
        let shift = u32::from(completed_attempts.saturating_sub(1)).min(6);
        let delay_ms = self
            .base_delay_ms
            .saturating_mul(1_u64 << shift)
            .min(self.max_delay_ms);
        RetryDecision::Retry { delay_ms }
    }
}

fn retryable(error: ModelError) -> bool {
    matches!(
        error,
        ModelError::RateLimited
            | ModelError::HttpRateLimited(_)
            | ModelError::Unavailable
            | ModelError::TimedOut
            | ModelError::ConnectionFailed
            | ModelError::ResponseReadFailed
            | ModelError::IncompleteStream
            | ModelError::ServerOverloaded
            | ModelError::InternalServerError
            | ModelError::UnexpectedStatus(500..=599)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_server_failures_retry_but_context_and_quota_do_not() {
        for error in [
            ModelError::TimedOut,
            ModelError::ConnectionFailed,
            ModelError::ResponseReadFailed,
            ModelError::ServerOverloaded,
            ModelError::InternalServerError,
            ModelError::UnexpectedStatus(500),
            ModelError::UnexpectedStatus(503),
        ] {
            assert!(matches!(
                RetryPolicy::DEFAULT.decide(error, 1),
                RetryDecision::Retry { .. }
            ));
            assert!(matches!(
                RetryPolicy::DEFAULT.decide(error, 5),
                RetryDecision::Retry { .. }
            ));
            assert_eq!(RetryPolicy::DEFAULT.decide(error, 6), RetryDecision::Stop);
        }
        for error in [
            ModelError::ContextWindowExceeded,
            ModelError::UsageLimitReached,
            ModelError::Authentication,
            ModelError::HttpAuthentication(401),
            ModelError::HttpAuthentication(403),
            ModelError::InvalidRequest,
            ModelError::UnexpectedStatus(302),
            ModelError::UnexpectedStatus(422),
        ] {
            assert_eq!(RetryPolicy::DEFAULT.decide(error, 1), RetryDecision::Stop);
        }
    }

    #[test]
    fn retries_only_transient_model_failures_with_bounded_backoff() {
        let policy = RetryPolicy {
            max_attempts: 4,
            base_delay_ms: 10,
            max_delay_ms: 15,
        };
        assert_eq!(
            policy.decide(ModelError::RateLimited, 1),
            RetryDecision::Retry { delay_ms: 10 }
        );
        assert_eq!(
            policy.decide(ModelError::HttpRateLimited(429), 1),
            policy.decide(ModelError::RateLimited, 1)
        );
        assert_eq!(
            policy.decide(ModelError::Unavailable, 2),
            RetryDecision::Retry { delay_ms: 15 }
        );
        assert_eq!(
            policy.decide(ModelError::IncompleteStream, 4),
            RetryDecision::Stop
        );
    }

    #[test]
    fn cancellation_auth_and_invalid_requests_never_retry() {
        for error in [
            ModelError::Canceled,
            ModelError::Authentication,
            ModelError::InvalidRequest,
            ModelError::UnsupportedCapability,
            ModelError::UnsupportedResponseType,
            ModelError::BudgetExceeded,
        ] {
            assert_eq!(RetryPolicy::DEFAULT.decide(error, 1), RetryDecision::Stop);
        }
    }
}
