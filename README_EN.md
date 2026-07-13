# LogGopher

<p align="center">
  <img src="build/appicon.png" width="144" alt="LogGopher Logo">
</p>

<p align="center">
  <strong>Cross-platform desktop log explorer for Alibaba Cloud SLS, Tencent Cloud CLS, and AWS CloudWatch Logs</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

LogGopher is a cross-platform desktop log explorer built with Go, Wails, and React. A unified Adapter contract isolates cloud SDK differences so connection management, resource navigation, time filtering, querying, pagination, and structured result inspection remain consistent across providers.

The application mark combines a Gopher, log lines, and a search lens. `build/appicon.png` is the 1024px RGBA source asset, and the multi-size Windows icon is stored at `build/windows/icon.ico`.

## Features

- Light, dark, and system themes with Chinese/English language support and display density settings.
- Tree navigation for `Project/Region → Logstore/Topic/Log Group`.
- Searchable and paginated saved connections with aliases and quick reconnect.
- Automatic query reset when switching logstores, followed by an unfiltered query for the active time range.
- Relative time presets, custom date-time selection, exact-minute mode, and histogram drill-down.
- Query completion, persistent history, favorites, and `Ctrl/Cmd + Enter` line breaks.
- Recursive recognition of JSON Objects/Arrays embedded inside string values.
- Per-connection and per-logstore JSON expansion depth from 0 to 8, defaulting to 2.
- Copy, include, or exclude actions for selected log values.
- Raw and table views, field visibility controls, pagination, and custom page size.
- Structured JSON runtime logs with direct access through Help → Open Log Folder.
- Native application menus for windows, full screen, themes, languages, and standard clipboard shortcuts.

## Supported providers

| Provider | Resource navigation | Query mode | Status |
|---|---|---|---|
| Alibaba Cloud SLS | Project → Logstore | SLS syntax, pagination, Histogram | Official Go SDK integrated |
| Tencent Cloud CLS | Region → Topic | CQL, offset pagination, time-series statistics | Official Go SDK integrated |
| AWS CloudWatch Logs | Region → Log Group | Filter Pattern, token pagination | AWS SDK for Go v2 integrated |

CloudWatch `FilterLogEvents` does not return an exact total. LogGopher exposes a safe lower bound that keeps the next page reachable instead of scanning an entire Log Group. No synthetic Histogram is generated before Logs Insights aggregation is implemented.

## Requirements

- Go `1.25`; the repository pins Toolchain `go1.25.10`
- Node.js `20+`
- Wails v2 platform dependencies
- macOS, Windows, or Linux

Development and validation must use the GOROOT configured for this project in GoLand. Do not silently fall back to the system Go installation or rely on automatic Toolchain downloads.

## Quick start

```bash
git clone https://github.com/liangguifeng/LogGopher.git
cd LogGopher

cd frontend
npm install
cd ..

make doctor
make dev
```

Production build:

```bash
make build
```

Build artifacts are written to `build/bin/`.

## Connection settings

### Alibaba Cloud SLS

- Endpoint, for example `https://cn-hangzhou.log.aliyuncs.com`
- Access Key ID / Access Key Secret
- No Project input is required; LogGopher calls `ListProject` and builds the Project/Logstore tree automatically
- Recommended permissions: `log:ListProject`, Logstore listing, and read-only query access for target Projects

### Tencent Cloud CLS

- Endpoint, for example `https://cls.tencentcloudapi.com`
- SecretId / SecretKey
- Region, for example `ap-guangzhou`
- Topics are discovered through paginated API calls

### AWS CloudWatch Logs

- Endpoint, for example `https://logs.us-east-1.amazonaws.com`
- Access Key ID / Secret Access Key
- Region, for example `us-east-1`
- IAM requires at least `logs:DescribeLogGroups` and `logs:FilterLogEvents` for target Log Groups

## Data and credentials

- SQLite stores only non-secret metadata such as Adapter, Endpoint, Project, Region, alias, and UI settings.
- AK/SK values are stored exclusively in macOS Keychain, Windows Credential Manager, or Linux Secret Service.
- The default SQLite location is `os.UserConfigDir()/LogGopher/loggopher.db`.
- All SQL statements are parameterized, and schema changes require explicit migrations.
- Runtime JSON logs are not automatically redacted. Callers must never write AK, SK, tokens, or passwords into log attributes.

Default runtime log directories:

| Platform | Directory |
|---|---|
| macOS | `~/Library/Logs/LogGopher` |
| Windows | `%LocalAppData%/LogGopher/logs` |
| Linux | `$XDG_STATE_HOME/LogGopher/logs` or `~/.local/state/LogGopher/logs` |

## Tests and quality gates

```bash
make test       # Go unit/integration tests + Frontend Vitest
make test-race  # Go race detector + Frontend Vitest
make coverage   # Go and Frontend coverage reports with minimum thresholds
make check      # Go test/vet + Frontend test/build
make build      # Wails production package
```

The test suite covers Domain validation, SQLite migrations/CRUD, the Credential Store, Application sessions, Wails API boundaries, request mapping for all three cloud Adapters, and critical React interactions. The minimum Go coverage is 60%. Frontend thresholds are 45% statements, 35% branches, 40% functions, and 45% lines.

## Project layout

```text
.
├── app.go                     # Wails API boundary
├── main.go                    # Dependency assembly and window options
├── menu.go                    # Native menus and shortcuts
├── internal/
│   ├── adapter/               # SLS, CLS, and CloudWatch Adapters
│   ├── application/           # Sessions and use-case orchestration
│   ├── credential/            # Operating-system credential store
│   ├── domain/                # Unified domain DTOs
│   ├── logging/               # JSON runtime logging
│   └── storage/               # SQLite and migrations
├── frontend/
│   ├── src/app/               # React application and Wails orchestration
│   ├── src/components/        # Reusable components
│   ├── src/features/          # Log result features
│   ├── src/styles/            # Light/Dark themes and layout
│   └── wailsjs/               # Auto-generated Wails bindings
├── docs/COMMENTING.md         # English comment conventions
├── DESIGN.md                  # Architecture and security decisions
└── AGENTS.md                  # Agent development rules
```

## Adding a provider

A new Adapter must implement:

```go
type Adapter interface {
    Info() domain.AdapterInfo
    Connect(context.Context, domain.ConnectionInput) ([]domain.LogGroup, error)
    Query(context.Context, domain.ConnectionInput, domain.QueryInput) (domain.QueryResult, error)
}
```

Vendor SDK types must remain inside `internal/adapter`. Every Adapter must support context cancellation, explicit errors, pagination, and mapping into the shared DTOs. Never return synthetic cloud data after a provider failure.

## Contributing

Issues, bug reports, feature proposals, and pull requests are welcome. Before submitting a change:

1. Read `AGENTS.md`, `DESIGN.md`, and `docs/COMMENTING.md`.
2. Add tests and English code comments for behavioral changes.
3. Run `make check` and `make coverage`.
4. Update documentation for architecture, security, or user-visible behavior changes.

Many thanks to JetBrains for providing me with a license to work on this project and other open-source projects.

[![JetBrains](https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.svg)](https://www.jetbrains.com/?from=https://github.com/liangguifeng)
