# HBS

Framework-independent, stable-unit text synchronization and explicit review.
Import through `@research-assistant/core/hbs`; never import the frozen experiment.

The client requires an injected text policy, semantic transport port, request-ID
factory and optional S′ store. Database/file I/O and wire codecs live in adapters.
`HbsClient.open()` supports asynchronous recovery. The editor retains native undo
history and uses `client.history` to reconcile review/conflict context.

Model rules, injection contracts, limitations and a complete integration example:
[note-hbs-model.md](../../../../docs/architecture/note-hbs-model.md#10-冻结参考与通用模块).
