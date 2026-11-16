# ra-workbench-sdk

公开的 Web／Native 契约和框架无关共享逻辑。Web SDK 的权威版本位于 packages/workbench-sdk/package.json，当前为 0.1.0。私有工程根省略版本。Native crate 各自维护 Cargo.toml。

## 包归属

- core、data、writing 提供原有公开纯契约、HBS 和客户端控制器。
- workbench-sdk 提供声明、贡献、配置、兼容解析和同源 facade 契约。
- workbench-native-sdk、agent-api、semantic-engine-api 提供有限 wire 类型、不可变 Agent 输入和纯编解码。
- note-query 提供共享笔记排序／搜索规则及 Wasm 产物。
- Agent 执行引擎由 ra-workbench 的 packages/agent-core 拥有。

## 构建与测试

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test:contracts
pnpm test -- packages/core/src/notes/noteCatalogText.test.ts
pnpm test:native
```

Wasm 构建需要 wasm32-unknown-unknown 和 wasm-bindgen-cli 0.2.105。NOTE_QUERY_RUSTC 与 NOTE_QUERY_WASM_BINDGEN 可选择预先准备的本地工具链。公开分发目录由 artifacts/sdk/latest.json 指向，包含公开包、纯 Native 源码产物、查询 Wasm、构建工具和 sdk-artifacts.json。清单记录每项版本与 SHA-256，构建成功后更新产物清单。

消费者执行产物目录中的 install-sdk.mjs，版本和完整性通过后将依赖安装到消费者自己的 .dependencies/sdk/。源码联调和完整应用契约验收由 research-assistant 的 integration/ 负责。

## 构建缓存与产物

标准构建入口复用通过完整性校验的既有包。产物在本工程 `artifacts/<kind>/<内容哈希>/package/`，当前入口在 `artifacts/<kind>/latest.json`。回执随产物保存，`.cache/build` 保存索引，`.cache/logs` 保存日志，`.cache/work` 为完成后清理的隔离工作目录。清理编译缓存后仍可复用已保存的当前包。
