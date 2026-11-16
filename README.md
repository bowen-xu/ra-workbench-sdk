# ra-workbench-sdk

公开的 Web／Native 契约和框架无关共享逻辑。Web SDK 的权威版本位于 packages/workbench-sdk/package.json，当前为 0.1.0。私有工程根省略版本。Native crate 各自维护 Cargo.toml。

## 包归属

- core、data、writing 提供原有公开纯契约、HBS 和客户端控制器。
- workbench-sdk 提供声明、贡献、配置、兼容解析和同源 facade 契约。
- workbench-native-sdk、agent-api、semantic-engine-api 提供有限 wire 类型、不可变 Agent 输入和纯编解码。
- note-query 提供共享笔记排序／搜索规则及 Wasm 产物。
- Agent 执行引擎由 ra-workbench 的 packages/agent-core 拥有。

## 构建与测试

以下命令在本工程根目录执行。

```sh
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` 生成 Web 包、纯 Native 源码包、查询 Wasm 和构建工具的公开分发产物。
需要编译验证 Native SDK 库时可单独执行。

```sh
cargo build --locked --lib --manifest-path packages/workbench-native-sdk/Cargo.toml
```

按需选择类型检查与测试。

```sh
pnpm typecheck
pnpm test:contracts
pnpm exec vitest run packages/core/src/notes/noteCatalogText.test.ts
pnpm test:native
```

Wasm 构建需要 wasm32-unknown-unknown 和 wasm-bindgen-cli 0.2.105。NOTE_QUERY_RUSTC 与 NOTE_QUERY_WASM_BINDGEN 可选择预先准备的本地工具链。公开分发目录由 artifacts/sdk/latest.json 指向，包含公开包、纯 Native 源码产物、查询 Wasm、构建工具和 sdk-artifacts.json。清单记录每项版本与 SHA-256，构建成功后更新产物清单。

消费者执行产物目录中的 `install-sdk.mjs`，版本和完整性通过后将依赖安装到
消费者自己的 `.dependencies/sdk/`。例如在产物目录外安装到指定工程。

```sh
node /absolute/path/to/sdk-package/install-sdk.mjs /absolute/path/to/sdk-package /absolute/path/to/consumer-project
```

Workbench 和插件自己的 `pnpm sdk:install /absolute/path/to/sdk-package` 调用同一安装器。
各工程维护自己的实现测试，完整应用组合验收由 Research Assistant 父仓库协调。

## 构建缓存与产物

| 路径 | 内容 |
|---|---|
| `artifacts/sdk/latest.json` | 当前公开 SDK 分发目录与回执 |
| `artifacts/sdk/<内容哈希>/package/` | Web 包、Native 源码包、查询 Wasm、工具及 `sdk-artifacts.json` |
| `.cache/cargo/note-query/` | 查询 Wasm 的持久 Cargo 缓存 |
| `packages/*/target/` | 直接执行各 Rust crate 检查与测试产生的编译缓存 |
| `.cache/build/` | 构建输入到已有包的索引 |
| `.cache/logs/` | 按次保存的构建日志 |
| `.cache/work/` | 隔离构建工作目录 |

标准构建入口校验并复用完整产物。回执随产物保存。清理编译缓存后，同输入构建
仍可复用已保存的当前包，并恢复本地开发所需的 SDK 声明。

工程位于 Research Assistant 父仓库时，可在父仓库根目录运行统一清理入口。

```sh
pnpm clean:cache sdk --dry-run
pnpm clean:cache sdk
pnpm clean:cache sdk --kind logs
```

默认清理编译缓存并保留构建索引。`--kind logs` 选择构建日志，`--kind all`
还清理构建索引及残留隔离工作目录。索引清除后，构建工具回退核对当前
`latest.json` 对应的包，其他历史输入组合可能重新构建。清理范围与命令说明见
父仓库 README 的缓存章节。
