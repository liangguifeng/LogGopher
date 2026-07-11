# LogGopher

LogGopher 是基于 Go + Wails + React 的桌面日志查询工作台。它用统一 Adapter 接口屏蔽阿里云 SLS、腾讯云 CLS、AWS CloudWatch Logs 的差异，连接后以 Logstore/Log Group 树和查询结果表提供一致体验。

## 当前能力

- Wails v2 桌面框架与 React + TypeScript 前端
- SQLite 连接配置库，自动创建于用户配置目录
- 亮色、暗色、跟随系统主题，中文/English 与舒适/紧凑显示密度
- 原生应用菜单：应用、文件、编辑、视图、窗口、帮助及标准快捷键
- Adapter Registry、连接、Logstore 获取、查询的完整扩展契约
- 可运行的“本地演示”适配器，用于验证端到端流程
- 阿里云 SLS、腾讯云 CLS、AWS CloudWatch Adapter 占位与明确的未实现错误
- 历史连接可直接选择并重连；AK/SK 由系统 Keychain/Credential Manager/Secret Service 保存

> 云厂商真实 SDK 尚未接入。界面上的“SDK 待接入”是有意设计，不能误认为已能访问线上日志。

## 快速开始

要求：Go 1.23+、Node.js 20+、Wails 平台依赖。

```bash
cd frontend && npm install && cd ..
make doctor
make dev
```

启动后选择“本地演示”，点击连接，即可浏览示例 Logstore 并执行查询。生产构建：

```bash
make build
```

## 目录结构

```text
.
├── app.go                     # 暴露给 Wails 前端的 API 门面
├── main.go                    # 依赖装配与窗口配置
├── internal/
│   ├── adapter/               # Adapter 接口、Registry、实现
│   ├── application/           # 用例编排与会话管理
│   ├── domain/                # 前后端共享领域 DTO
│   └── storage/               # SQLite 持久化与 migration
├── frontend/src/              # React 日志工作台
├── DESIGN.md                  # 架构、安全与决策说明
└── AGENTS.md                  # Coding Agent 项目指南
```

## Adapter 接入

新平台实现 `internal/adapter.Adapter` 的 `Info`、`Connect`、`Query` 三个方法，并在 `DefaultRegistry` 注册。Adapter 必须使用传入的 `context.Context` 控制超时/取消，将厂商响应转换为 `domain.QueryResult`，且不得记录凭证。

## 数据库

SQLite 文件位于 `os.UserConfigDir()/LogGopher/loggopher.db`。`profiles` 表仅保存 Adapter、Endpoint、Project、Region 等非敏感元数据；AK/SK 以 Profile ID 为索引写入操作系统凭证库；`app_settings` 保存主题、语言与显示密度。Schema 变更应追加有序 migration，禁止直接依赖隐式结构变化。

## 验证

```bash
go test ./...
go vet ./...
cd frontend && npm run build
wails build
```
