# LogGopher

<p align="center">
  <img src="build/appicon.png" width="144" alt="LogGopher Logo">
</p>

<p align="center">
  <strong>面向阿里云 SLS、腾讯云 CLS 与 AWS CloudWatch Logs 的跨平台桌面日志浏览器</strong>
</p>

<p align="center">
  简体中文 | <a href="README_EN.md">English</a>
</p>

LogGopher 是一个使用 Go、Wails 和 React 构建的跨平台桌面日志查询工具。它通过统一的 Adapter 契约隔离不同云厂商 SDK，让连接管理、日志库导航、时间筛选、查询、分页和结构化结果浏览保持一致。

应用标识由 Gopher、日志行和搜索镜组成。`build/appicon.png` 是 1024px RGBA 母版，Windows 多尺寸图标位于 `build/windows/icon.ico`。

## 功能特性

- 支持亮色、暗色和跟随系统主题，以及中文、English 和显示密度切换。
- 使用树形导航展示 `Project/Region → Logstore/Topic/Log Group`。
- 支持历史连接搜索、分页、快速重连和连接别名。
- 切换日志库时自动清空旧查询条件，并加载新日志库当前时间范围内的日志。
- 提供时间范围预设、自定义日期时间、整点时间和柱状分布钻取。
- 查询编辑器支持字段提示、查询历史、收藏，以及 `Ctrl/Cmd + Enter` 换行。
- 原始日志树可递归识别 JSON string 中嵌套的 Object/Array。
- JSON 默认展开层级可按当前连接与日志库独立设置，范围为 0–8 层，默认 2 层。
- 点击日志字段值可复制、加入筛选或排除。
- 支持原始日志和表格视图、字段显隐、分页和每页数量设置。
- 使用 `log/slog` 输出逐行 JSON 运行日志，并支持从“帮助 → 打开日志目录”访问日志文件。
- 原生菜单支持窗口、全屏、主题、语言和标准剪切、复制、粘贴快捷键。

## 云平台支持

| 平台 | 资源导航 | 查询方式 | 状态 |
|---|---|---|---|
| 阿里云 SLS | Project → Logstore | SLS 查询语法、分页、Histogram | 已接入官方 Go SDK |
| 腾讯云 CLS | Region → Topic | CQL、Offset 分页、时间序列统计 | 已接入官方 Go SDK |
| AWS CloudWatch Logs | Region → Log Group | Filter Pattern、Token 分页 | 已接入 AWS SDK for Go v2 |

CloudWatch `FilterLogEvents` 不返回精确总数。LogGopher 使用能够保证下一页可访问的安全下界，不会为了计算总数扫描整个 Log Group；在接入 Logs Insights 聚合前不生成虚假的 Histogram。

## 系统要求

- Go `1.25`，项目当前固定 Toolchain `go1.25.10`
- Node.js `20+`
- Wails v2 对应平台依赖
- macOS、Windows 或 Linux

项目开发和验证应使用 GoLand 为该项目配置的 GOROOT，不能静默回退到系统 Go 或依赖自动 Toolchain 下载。当前开发机 GOROOT 为：

```bash
$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.25.10.darwin-arm64
```

## 快速开始

```bash
git clone https://github.com/liangguifeng/LogGopher.git
cd LogGopher

cd frontend
npm install
cd ..

make doctor
make dev
```

生产构建：

```bash
make build
```

构建产物位于 `build/bin/`。

## 连接配置

### 阿里云 SLS

- Endpoint：例如 `https://cn-hangzhou.log.aliyuncs.com`
- Access Key ID / Access Key Secret
- 无需手工输入 Project；连接后自动调用 `ListProject` 并展示 Project/Logstore 树
- 建议权限：`log:ListProject`、目标 Project 的 Logstore 枚举和只读查询权限

### 腾讯云 CLS

- Endpoint：例如 `https://cls.tencentcloudapi.com`
- SecretId / SecretKey
- Region：例如 `ap-guangzhou`
- 连接后自动分页枚举 Topic

### AWS CloudWatch Logs

- Endpoint：例如 `https://logs.us-east-1.amazonaws.com`
- Access Key ID / Secret Access Key
- Region：例如 `us-east-1`
- IAM 至少需要 `logs:DescribeLogGroups` 和目标 Log Group 的 `logs:FilterLogEvents`

## 数据与凭证

- SQLite 仅保存 Adapter、Endpoint、Project、Region、别名和界面设置等非敏感元数据。
- AK/SK 仅写入操作系统凭证库：macOS Keychain、Windows Credential Manager 或 Linux Secret Service。
- SQLite 默认位置为 `os.UserConfigDir()/LogGopher/loggopher.db`。
- 所有 SQL 使用参数化查询，Schema 变更必须追加 migration。
- Runtime JSON 日志不会自动脱敏，调用方不得将 AK、SK、Token 或密码写入日志属性。

运行日志默认目录：

| 系统 | 目录 |
|---|---|
| macOS | `~/Library/Logs/LogGopher` |
| Windows | `%LocalAppData%/LogGopher/logs` |
| Linux | `$XDG_STATE_HOME/LogGopher/logs` 或 `~/.local/state/LogGopher/logs` |

## 测试与质量门禁

```bash
make test       # Go 单元/集成测试 + Frontend Vitest
make test-race  # Go Race Detector + Frontend Vitest
make coverage   # Go 与 Frontend 覆盖率报告及最低阈值检查
make check      # Go test/vet + Frontend test/build
make build      # Wails Production Build
```

测试覆盖 Domain 校验、SQLite migration/CRUD、Credential Store、Application 会话、Wails API 边界、三云 Adapter 请求映射，以及关键 React 交互。Go 总覆盖率门禁为 60%；Frontend 门禁为 statements 45%、branches 35%、functions 40%、lines 45%。

## 项目结构

```text
.
├── app.go                     # Wails API 边界
├── main.go                    # 应用装配和窗口配置
├── menu.go                    # 原生菜单与快捷键
├── internal/
│   ├── adapter/               # SLS、CLS、CloudWatch Adapter
│   ├── application/           # 会话和用例编排
│   ├── credential/            # 操作系统凭证库
│   ├── domain/                # 统一领域 DTO
│   ├── logging/               # JSON 运行日志
│   └── storage/               # SQLite 与 migration
├── frontend/
│   ├── src/app/               # React 应用与 Wails 调用编排
│   ├── src/components/        # 通用组件
│   ├── src/features/          # 日志结果等业务功能
│   ├── src/styles/            # Light/Dark 主题与布局
│   └── wailsjs/               # Wails 自动生成绑定
├── docs/COMMENTING.md         # 英文注释规范
├── DESIGN.md                  # 架构与安全决策
└── AGENTS.md                  # Agent 开发约束
```

## 扩展新的日志平台

新的平台 Adapter 必须实现：

```go
type Adapter interface {
    Info() domain.AdapterInfo
    Connect(context.Context, domain.ConnectionInput) ([]domain.LogGroup, error)
    Query(context.Context, domain.ConnectionInput, domain.QueryInput) (domain.QueryResult, error)
}
```

厂商 SDK 类型必须限制在 `internal/adapter` 内。Adapter 必须支持 Context cancellation、显式错误、分页和统一 DTO 映射，禁止在云端失败时返回 synthetic data。

## 贡献

欢迎 Issue、Bug Report、功能建议和 Pull Request。提交前请：

1. 阅读 `AGENTS.md`、`DESIGN.md` 和 `docs/COMMENTING.md`。
2. 为行为变更补充测试和英文代码注释。
3. 执行 `make check` 和 `make coverage`。
4. 架构、安全或用户行为变化应同步更新文档。

非常感谢 JetBrains 向我提供了执照，可以从事该项目和其他开源项目。

[![JetBrains](https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.svg)](https://www.jetbrains.com/?from=https://github.com/liangguifeng)
