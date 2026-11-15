use super::*;
use crate::{
    context::token_budget::{TokenBudgetPolicy, TokenBudgetSettings, TokenBudgetWindow},
    model::ModelError,
    tool_registry::{ToolRegistry, ToolRegistryError},
};
use std::sync::Mutex;
use uuid::Uuid;

struct Runtime {
    window: Mutex<TokenBudgetWindow>,
    remaining: Option<u64>,
    reject: bool,
}
impl TokenBudgetToolRuntime for Runtime {
    fn request_new_window(&self) -> RunFuture<'_, ()> {
        Box::pin(async move {
            if self.reject {
                return Err(ModelError::Canceled.into());
            }
            self.window.lock().unwrap().request_new_context_window();
            Ok(())
        })
    }
    fn tokens_remaining(&self) -> RunFuture<'_, Option<u64>> {
        Box::pin(async move {
            if self.reject {
                return Err(ModelError::InvalidRequest.into());
            }
            Ok(self.remaining)
        })
    }
}
fn call(name: &str) -> ToolCall {
    ToolCall {
        namespace: None,
        raw_arguments_json: None,
        call_id: "call".into(),
        name: name.into(),
        arguments: json!({}),
    }
}
fn runtime(remaining: Option<u64>) -> Runtime {
    Runtime {
        window: Mutex::new(TokenBudgetWindow::initial(Uuid::from_u128(1)).unwrap()),
        remaining,
        reject: false,
    }
}
#[tokio::test]
async fn registration_is_opt_in_and_rejects_unknown_arguments_or_shadowing() {
    let disabled = TokenBudgetTools::new(None);
    let registry = ToolRegistry::from_registrations([disabled.registration()]).unwrap();
    assert!(registry.definitions().is_empty());
    assert!(matches!(
        registry.authorize_and_execute(call(NEW_CONTEXT)).await,
        Err(RunError::ToolNotFound)
    ));
    assert!(matches!(
        disabled.authorize_and_execute(call(NEW_CONTEXT)).await,
        Err(RunError::ToolRejected)
    ));
    let runtime = runtime(Some(9));
    let tools = TokenBudgetTools::new(Some(&runtime));
    let registry = ToolRegistry::from_registrations([tools.registration()]).unwrap();
    assert_eq!(
        registry
            .definitions()
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>(),
        vec![NEW_CONTEXT, GET_CONTEXT_REMAINING]
    );
    assert!(matches!(
        ToolRegistry::from_registrations([tools.registration(), tools.registration()]),
        Err(ToolRegistryError::DuplicateName(_))
    ));
    let mut invalid = call(NEW_CONTEXT);
    invalid.arguments = json!({"execute_now":true});
    assert!(matches!(
        registry.authorize_and_execute(invalid).await,
        Err(RunError::ToolArguments(_))
    ));
    let mut invalid = call(NEW_CONTEXT);
    invalid.arguments = json!(null);
    assert!(matches!(
        registry.authorize_and_execute(invalid).await,
        Err(RunError::ToolArguments(_))
    ));
    assert!(matches!(
        registry.authorize_and_execute(call("compact")).await,
        Err(RunError::ToolNotFound)
    ));
}
#[tokio::test]
async fn new_context_sets_only_a_flag_and_rolls_over_at_a_followup_boundary() {
    let runtime = runtime(Some(9));
    let tools = TokenBudgetTools::new(Some(&runtime));
    let registry = ToolRegistry::from_registrations([tools.registration()]).unwrap();
    let output = registry
        .authorize_and_execute(call(NEW_CONTEXT))
        .await
        .unwrap();
    assert!(!output.is_error);
    assert!(output.content.contains("without summarizing"));
    let mut window = runtime.window.lock().unwrap();
    assert_eq!(window.id(), Uuid::from_u128(1));
    let policy = TokenBudgetPolicy::resolve(TokenBudgetSettings::default()).unwrap();
    let status = crate::context::token_budget::TokenBudgetStatus {
        active_context_tokens: Some(1),
        auto_compact_scope_tokens: Some(1),
        auto_compact_scope_limit: Some(10),
        full_context_window_limit: Some(10),
        base_window_tokens_remaining: Some(9),
        full_context_window_limit_reached: false,
        token_limit_reached: false,
    };
    assert!(!window.post_sampling(&policy, status, false).rollover);
    assert!(window.post_sampling(&policy, status, true).rollover);
    assert_eq!(window.id(), Uuid::from_u128(1)); // Decision is not installation.
    window.advance(Uuid::from_u128(2)).unwrap();
    assert_eq!(window.number(), 1);
    assert!(!window.post_sampling(&policy, status, true).rollover);
}
#[tokio::test]
async fn remaining_keeps_unknown_and_zero_distinct_and_propagates_host_failure() {
    for (tokens, text) in [(None, "unknown"), (Some(0), "0"), (Some(9), "9")] {
        let runtime = runtime(tokens);
        let tools = TokenBudgetTools::new(Some(&runtime));
        let output = tools
            .authorize_and_execute(call(GET_CONTEXT_REMAINING))
            .await
            .unwrap();
        assert_eq!(
            output.content,
            format!("You have {text} tokens left in this context window.")
        );
        assert_eq!(runtime.window.lock().unwrap().id(), Uuid::from_u128(1));
    }
    let mut runtime = runtime(None);
    runtime.reject = true;
    let tools = TokenBudgetTools::new(Some(&runtime));
    assert!(matches!(
        tools.authorize_and_execute(call(NEW_CONTEXT)).await,
        Err(RunError::Model(ModelError::Canceled))
    ));
    assert!(matches!(
        tools
            .authorize_and_execute(call(GET_CONTEXT_REMAINING))
            .await,
        Err(RunError::Model(ModelError::InvalidRequest))
    ));
}
