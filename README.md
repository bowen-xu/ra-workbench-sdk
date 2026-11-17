# Research Assistant SDK

独立 TypeScript SDK 工程，当前已建立包目录与严格 TypeScript 配置。

| 目录 | 职责 |
|---|---|
| `packages/core/src` | 框架无关领域与 HBS 纯逻辑 |
| `packages/data/src` | 公开数据网关与共享控制器 |
| `packages/writing/src` | 纯写作契约与不变量 |
| `packages/workbench-sdk/src` | 前端声明、激活与公开能力接口 |
| `packages/workbench-backend-sdk/src` | 后端有限协议、路径规则与资源契约 |
| `packages/agent-api/src` | Agent 公开输入与编解码 |
| `packages/semantic-engine-api/src` | 向量存储公开 DTO |
| `packages/note-query/src` | Web／Node 共享查询与排序 |
| `tests/contracts` | 公共合同验收 |
| `tests/compatibility` | 固定样本与版本兼容验收 |

工程作为独立 Git submodule 维护自己的 pnpm 工作区、锁文件和构建工具。
公开导出及构建入口在对应合同迁移时加入，消费者通过版本化包使用 SDK。
