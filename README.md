# LogGopher

LogGopher 是基于 Go + Wails + React 的桌面日志查询工作台。它用统一 Adapter 接口屏蔽阿里云 SLS、腾讯云 CLS、AWS CloudWatch Logs 的差异，连接后以 Logstore/Log Group 树和查询结果表提供一致体验。

代码注释统一使用英文；GoDoc 与 TypeScript JSDoc 规则见 [`docs/COMMENTING.md`](docs/COMMENTING.md)。

项目要求 Go 1.25，`go.mod` 当前固定 `go1.25.10` Toolchain。开发与验证应使用 GoLand 为项目配置的 GOROOT，而不是 PATH 中的系统 Go；当前工作站对应 `$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.25.10.darwin-arm64`。

## 当前能力

- Wails v2 桌面框架与 React + TypeScript 前端
- SQLite 连接配置库，自动创建于用户配置目录
- 亮色、暗色、跟随系统主题，中文/English 与舒适/紧凑显示密度
- JSON 结构化运行日志与自动滚动归档；可从“帮助 → 打开日志目录”直接查看 `.log` 文件
- 原生应用菜单：应用、文件、编辑、视图、窗口、帮助及标准快捷键
- Adapter Registry、连接、Logstore 获取、查询的完整扩展契约
- 查询结果支持按字段勾选显示；字段默认全选，取消后会同时从原始视图、标签和表格列中过滤；单条日志可一键复制当前 JSON
- 查询编辑器提供基于结果字段的智能补全与 SQLite 持久化历史；支持方向键选择、Tab/Enter 补全，并按连接配置和日志库隔离历史记录
- 阿里云 SLS 官方 Go SDK 接入：连接校验、Logstore 枚举、查询分页、精确匹配和结果归一化
- SLS 结果值筛选优先使用字段索引；未配置字段索引时自动降级为全文短语查询
- 腾讯云 CLS API 3.0 官方 Go SDK 接入：地域连接、Topic 分页枚举、CQL 检索、Offset 分页和字段归一化
- AWS CloudWatch Adapter 占位与明确的未实现错误
- 历史连接可直接选择并重连；AK/SK 由系统 Keychain/Credential Manager/Secret Service 保存
- 新建连接支持自定义连接别名；保存列表和侧栏配置切换均优先展示别名

> AWS CloudWatch 尚未接入真实 SDK，界面会明确显示“SDK 待接入”。阿里云 SLS 与腾讯云 CLS 已可访问线上服务。

## 快速开始

要求：Go 1.25（使用 GoLand 项目 GOROOT）、Node.js 20+、Wails 平台依赖。

```bash
cd frontend && npm install && cd ..
make doctor
make dev
```

阿里云 SLS 连接需要 Endpoint、AK、SK 与 Project，例如 `https://cn-hangzhou.log.aliyuncs.com`。腾讯云 CLS 连接需要 API Endpoint、SecretId、SecretKey 与地域，例如 `https://cls.tencentcloudapi.com` 和 `ap-guangzhou`；连接成功后左侧展示该地域的日志 Topic。建议仅授予目标资源的只读权限。生产构建：

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
├── frontend/
│   ├── src/app/               # React 应用壳与 Wails API 编排
│   ├── src/components/        # 跨业务复用的 UI 组件
│   ├── src/features/          # 按业务能力组织的功能模块
│   ├── src/styles/            # 全局主题、布局与兼容样式
│   ├── src/assets/            # 字体与图片资源
│   └── wailsjs/               # Wails 自动生成绑定，禁止手工维护
├── DESIGN.md                  # 架构、安全与决策说明
└── AGENTS.md                  # Coding Agent 项目指南
```

## Adapter 接入

新平台实现 `internal/adapter.Adapter` 的 `Info`、`Connect`、`Query` 三个方法，并在 `DefaultRegistry` 注册。Adapter 必须使用传入的 `context.Context` 控制超时/取消，将厂商响应转换为 `domain.QueryResult`，且不得记录凭证。

## 数据库

SQLite 文件位于 `os.UserConfigDir()/LogGopher/loggopher.db`。`profiles` 表仅保存 Adapter、Endpoint、Project、Region 等非敏感元数据；AK/SK 以 Profile ID 为索引写入操作系统凭证库；`app_settings` 保存主题、语言与显示密度。Schema 变更应追加有序 migration，禁止直接依赖隐式结构变化。

运行日志使用 Go `log/slog` 输出逐行 JSON，并由 `lumberjack` 按 10MB 滚动，最多保留 5 个备份和 14 天。macOS 默认写入 `~/Library/Logs/LogGopher`，Windows 写入 `%LocalAppData%/LogGopher/logs`，Linux 写入 `$XDG_STATE_HOME/LogGopher/logs`（未设置时为 `~/.local/state/LogGopher/logs`）。日志系统不执行内容脱敏，调用方传入的消息、属性和错误会原样写入文件。

## 验证

```bash
go test ./...
go vet ./...
cd frontend && npm run build
wails build
```
