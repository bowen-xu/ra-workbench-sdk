// Adapted from OpenAI Codex core/src/tools/registry.rs at
// e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Research Assistant keeps the name-to-executor ownership rule while omitting
// Codex product hooks, telemetry, sandbox tags, and response-specific payloads.
use crate::{
    model::{ToolCall, ToolDefinition},
    runner::{RunError, RunFuture, ToolExecutor, ToolNameResolution, ToolOutput},
};
use std::{collections::HashMap, sync::Arc};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ToolRegistryError {
    #[error("tool definition is invalid")]
    InvalidDefinition,
    #[error("tool {0} is already registered")]
    DuplicateName(String),
}

/// A group of schemas handled by one executor. The registry clones schemas so
/// the model-visible catalog and runtime routing are frozen together.
pub struct ToolRegistration<'a> {
    definitions: Vec<ToolDefinition>,
    executor: &'a dyn ToolExecutor,
}

/// Owned host contribution. Keeping schemas and their executor in one value
/// prevents callers from replacing one side without replacing the other.
#[derive(Clone)]
pub struct OwnedToolRegistration {
    definitions: Vec<ToolDefinition>,
    executor: Arc<dyn ToolExecutor>,
}

impl OwnedToolRegistration {
    pub fn new(definitions: Vec<ToolDefinition>, executor: Arc<dyn ToolExecutor>) -> Self {
        Self {
            definitions,
            executor,
        }
    }

    pub fn into_parts(self) -> (Vec<ToolDefinition>, Arc<dyn ToolExecutor>) {
        (self.definitions, self.executor)
    }

    pub fn borrowed(&self) -> ToolRegistration<'_> {
        ToolRegistration::new(self.definitions.clone(), self.executor.as_ref())
    }
}

impl<'a> ToolRegistration<'a> {
    pub fn new(definitions: Vec<ToolDefinition>, executor: &'a dyn ToolExecutor) -> Self {
        Self {
            definitions,
            executor,
        }
    }
}

/// Per-run registry. Duplicate names fail admission instead of silently
/// shadowing a handler. Definition order remains stable for provider requests.
pub struct ToolRegistry<'a> {
    definitions: Vec<ToolDefinition>,
    executors: HashMap<(Option<String>, String), &'a dyn ToolExecutor>,
    owners: Vec<&'a dyn ToolExecutor>,
}

impl<'a> ToolRegistry<'a> {
    pub fn from_registrations(
        registrations: impl IntoIterator<Item = ToolRegistration<'a>>,
    ) -> Result<Self, ToolRegistryError> {
        let mut definitions = Vec::new();
        let mut executors = HashMap::new();
        let mut owners = Vec::new();
        for registration in registrations {
            owners.push(registration.executor);
            for definition in registration.definitions {
                if definition.name.trim().is_empty() || !definition.parameters.is_object() {
                    return Err(ToolRegistryError::InvalidDefinition);
                }
                if executors
                    .insert(
                        (definition.namespace.clone(), definition.name.clone()),
                        registration.executor,
                    )
                    .is_some()
                {
                    return Err(ToolRegistryError::DuplicateName(definition.name));
                }
                definitions.push(definition);
            }
        }
        Ok(Self {
            definitions,
            executors,
            owners,
        })
    }

    pub fn definitions(&self) -> &[ToolDefinition] {
        &self.definitions
    }

    fn executor(
        &self,
        namespace: Option<&str>,
        name: &str,
    ) -> Result<&'a dyn ToolExecutor, RunError> {
        self.executors
            .get(&(namespace.map(str::to_owned), name.to_owned()))
            .copied()
            .ok_or(RunError::ToolNotFound)
    }

    fn executor_for_call(&self, call: &ToolCall) -> Result<&'a dyn ToolExecutor, RunError> {
        let namespace = call.namespace.as_deref();
        let owner = self.executor(namespace, &call.name)?;
        if namespace.is_some()
            && owner.resolve_qualified_name(namespace, &call.name) != ToolNameResolution::Registered
        {
            return Err(RunError::ToolNotFound);
        }
        Ok(owner)
    }
}

impl ToolExecutor for ToolRegistry<'_> {
    fn resolve_name(&self, name: &str) -> ToolNameResolution {
        self.resolve_qualified_name(None, name)
    }
    fn resolve_qualified_name(&self, namespace: Option<&str>, name: &str) -> ToolNameResolution {
        match self
            .executors
            .get(&(namespace.map(str::to_owned), name.to_owned()))
        {
            None => ToolNameResolution::NotFound,
            Some(owner) => match owner.resolve_qualified_name(namespace, name) {
                ToolNameResolution::Unspecified if namespace.is_none() => {
                    ToolNameResolution::Registered
                }
                status => status,
            },
        }
    }
    fn supports_parallel(&self, call: &ToolCall) -> bool {
        self.executor_for_call(call)
            .is_ok_and(|owner| owner.supports_parallel(call))
    }
    fn cancellation_safe_to_drop(&self, call: &ToolCall) -> bool {
        self.executor_for_call(call)
            .is_ok_and(|owner| owner.cancellation_safe_to_drop(call))
    }
    fn requires_result_receipt(&self, call: &ToolCall) -> bool {
        self.executor_for_call(call)
            .map_or(true, |owner| owner.requires_result_receipt(call))
    }
    fn child_creation_intent(
        &self,
        call: &ToolCall,
    ) -> Option<crate::conversation::CreateBoundConversation> {
        self.executor_for_call(call)
            .ok()?
            .child_creation_intent(call)
    }
    fn cancel_pending(&self, call: ToolCall) -> RunFuture<'_, ()> {
        match self.executor_for_call(&call) {
            Ok(executor) => executor.cancel_pending(call),
            Err(error) => Box::pin(async move { Err(error) }),
        }
    }
    fn release_for_finalization(&self) -> RunFuture<'_, bool> {
        Box::pin(async {
            let mut released = false;
            for owner in &self.owners {
                released |= owner.release_for_finalization().await?;
            }
            Ok(released)
        })
    }
    fn finalization_call(&self) -> RunFuture<'_, Option<ToolCall>> {
        Box::pin(async {
            for owner in &self.owners {
                if let Some(call) = owner.finalization_call().await? {
                    if !std::ptr::eq(self.executor_for_call(&call)?, *owner) {
                        return Err(RunError::ToolRejected);
                    }
                    self.validate(&call)?;
                    return Ok(Some(call));
                }
            }
            Ok(None)
        })
    }
    fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
        self.executor_for_call(call)?.validate(call)
    }

    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        match self.executor_for_call(&call) {
            Ok(executor) => executor.authorize_and_execute(call),
            Err(error) => Box::pin(async move { Err(error) }),
        }
    }

    fn result_committed(&self, call: ToolCall) -> RunFuture<'_, ()> {
        match self.executor_for_call(&call) {
            Ok(executor) => executor.result_committed(call),
            Err(error) => Box::pin(async move { Err(error) }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fake {
        name: &'static str,
        calls: AtomicUsize,
        receipts: AtomicUsize,
    }

    impl ToolExecutor for Fake {
        fn resolve_qualified_name(&self, _: Option<&str>, name: &str) -> ToolNameResolution {
            if name == self.name {
                ToolNameResolution::Registered
            } else {
                ToolNameResolution::NotFound
            }
        }
        fn validate(&self, call: &ToolCall) -> Result<(), RunError> {
            (call.name == self.name)
                .then_some(())
                .ok_or(RunError::ToolRejected)
        }

        fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ToolOutput {
                    content: "ok".into(),
                    is_error: false,
                })
            })
        }

        fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
            self.receipts.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }

    fn definition(name: &str) -> ToolDefinition {
        ToolDefinition {
            namespace: None,
            name: name.into(),
            description: format!("Run {name}"),
            parameters: json!({"type":"object"}),
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

    #[tokio::test]
    async fn definitions_and_all_execution_phases_share_exact_name_ownership() {
        let first = Fake {
            name: "first",
            calls: AtomicUsize::new(0),
            receipts: AtomicUsize::new(0),
        };
        let second = Fake {
            name: "second",
            calls: AtomicUsize::new(0),
            receipts: AtomicUsize::new(0),
        };
        let registry = ToolRegistry::from_registrations([
            ToolRegistration::new(vec![definition("first")], &first),
            ToolRegistration::new(vec![definition("second")], &second),
        ])
        .unwrap();

        assert_eq!(
            registry
                .definitions()
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        registry.validate(&call("second")).unwrap();
        registry
            .authorize_and_execute(call("second"))
            .await
            .unwrap();
        registry.result_committed(call("second")).await.unwrap();
        assert_eq!(first.calls.load(Ordering::SeqCst), 0);
        assert_eq!(second.calls.load(Ordering::SeqCst), 1);
        assert_eq!(second.receipts.load(Ordering::SeqCst), 1);
        assert!(registry.validate(&call("missing")).is_err());
        let mut foreign = call("second");
        foreign.namespace = Some("other".into());
        assert!(matches!(
            registry.validate(&foreign),
            Err(RunError::ToolNotFound)
        ));
        assert!(matches!(
            registry.authorize_and_execute(foreign).await,
            Err(RunError::ToolNotFound)
        ));
        assert_eq!(second.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn duplicate_or_invalid_definitions_fail_registry_construction() {
        let tool = Fake {
            name: "same",
            calls: AtomicUsize::new(0),
            receipts: AtomicUsize::new(0),
        };
        assert!(matches!(
            ToolRegistry::from_registrations([ToolRegistration::new(
                vec![definition("same"), definition("same")],
                &tool,
            )]),
            Err(ToolRegistryError::DuplicateName(name)) if name == "same"
        ));
        let mut invalid = definition("valid");
        invalid.parameters = json!([]);
        assert!(matches!(
            ToolRegistry::from_registrations([ToolRegistration::new(vec![invalid], &tool)]),
            Err(ToolRegistryError::InvalidDefinition)
        ));
    }

    #[tokio::test]
    async fn registry_keeps_executor_validation_after_name_routing() {
        let tool = Fake {
            name: "strict",
            calls: AtomicUsize::new(0),
            receipts: AtomicUsize::new(0),
        };
        let registry = ToolRegistry::from_registrations([ToolRegistration::new(
            vec![definition("strict")],
            &tool,
        )])
        .unwrap();

        let wrong_name = call("other");
        assert!(registry.validate(&wrong_name).is_err());
        assert!(registry.authorize_and_execute(wrong_name).await.is_err());
        assert_eq!(tool.calls.load(Ordering::SeqCst), 0);

        registry.validate(&call("strict")).unwrap();
        registry
            .authorize_and_execute(call("strict"))
            .await
            .unwrap();
        assert_eq!(tool.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn same_name_in_separate_namespaces_uses_its_exact_owner() {
        let make = || Fake {
            name: "read",
            calls: AtomicUsize::new(0),
            receipts: AtomicUsize::new(0),
        };
        let plain = make();
        let first = make();
        let second = make();
        let empty = make();
        let mut first_definition = definition("read");
        first_definition.namespace = Some("one".into());
        let mut second_definition = definition("read");
        second_definition.namespace = Some("two".into());
        let mut empty_definition = definition("read");
        empty_definition.namespace = Some(String::new());
        let registry = ToolRegistry::from_registrations([
            ToolRegistration::new(vec![definition("read")], &plain),
            ToolRegistration::new(vec![first_definition], &first),
            ToolRegistration::new(vec![second_definition], &second),
            ToolRegistration::new(vec![empty_definition], &empty),
        ])
        .unwrap();
        assert_eq!(
            registry.resolve_qualified_name(Some("one"), "read"),
            ToolNameResolution::Registered
        );
        assert_eq!(
            registry.resolve_qualified_name(Some("foreign"), "read"),
            ToolNameResolution::NotFound
        );
        for namespace in [None, Some("one"), Some("two"), Some("")] {
            let mut tool = call("read");
            tool.namespace = namespace.map(str::to_owned);
            registry.validate(&tool).unwrap();
            registry.authorize_and_execute(tool.clone()).await.unwrap();
            registry.result_committed(tool).await.unwrap();
        }
        for owner in [&plain, &first, &second, &empty] {
            assert_eq!(owner.calls.load(Ordering::SeqCst), 1);
            assert_eq!(owner.receipts.load(Ordering::SeqCst), 1);
        }
        let mut foreign = call("read");
        foreign.namespace = Some("foreign".into());
        assert!(matches!(
            registry.authorize_and_execute(foreign).await,
            Err(RunError::ToolNotFound)
        ));
    }

    #[tokio::test]
    async fn namespaced_registration_cannot_grant_a_flat_only_owner() {
        struct FlatOnly;
        impl ToolExecutor for FlatOnly {
            fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
                panic!("must not validate")
            }
            fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
                panic!("must not execute")
            }
        }
        let mut schema = definition("read");
        schema.namespace = Some("group".into());
        let registry =
            ToolRegistry::from_registrations([ToolRegistration::new(vec![schema], &FlatOnly)])
                .unwrap();
        let mut tool = call("read");
        tool.namespace = Some("group".into());
        assert_eq!(
            registry.resolve_qualified_name(Some("group"), "read"),
            ToolNameResolution::NotFound
        );
        assert!(matches!(
            registry.validate(&tool),
            Err(RunError::ToolNotFound)
        ));
        assert!(matches!(
            registry.authorize_and_execute(tool).await,
            Err(RunError::ToolNotFound)
        ));
    }
}
