# LogGopher

<p align="center">
  <img src="build/appicon.png" width="128" alt="LogGopher Logo">
</p>

<p align="center">
  <strong>A simple, unified desktop explorer for multi-cloud logs</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

LogGopher is a cross-platform log explorer built with Go, Wails, and React. It connects to Alibaba Cloud SLS, Tencent Cloud CLS, and AWS CloudWatch Logs through one consistent interface, making it easier to query, filter, and inspect logs across cloud providers.

## Features

- Search, paginate, inspect, edit, and switch cloud connections in a desktop workspace
- Browse resources as Project/Region and Logstore/Topic/Log Group trees
- Filter by time, reuse query history, paginate results, and inspect histograms
- Expand nested JSON, filter fields, and switch between raw and table views
- Switch light, dark, system, Chinese, and English preferences from a dedicated settings page
- Store connection profiles and AK/SK together in the local SQLite database
- Refill AK while editing and keep SK masked until explicitly revealed

## Getting started

Download a package for your operating system and CPU architecture from [GitHub Releases](https://github.com/liangguifeng/LogGopher/releases).

Requirements: Go 1.25, Node.js 20+, and the platform dependencies listed in the [Wails v2 installation guide](https://wails.io/docs/gettingstarted/installation).

```bash
git clone https://github.com/liangguifeng/LogGopher.git
cd LogGopher

cd frontend
npm install
cd ..

make doctor
make dev
```

Build a production package:

```bash
make build
```

## Project structure

```text
.
├── app.go                 # Wails API boundary
├── main.go                # Entry point and dependency assembly
├── menu.go                # Native application menus
├── internal/
│   ├── adapter/           # Cloud log adapters
│   ├── application/       # Use cases and sessions
│   ├── credential/        # SQLite credential access and legacy migration
│   ├── domain/            # Shared domain model
│   ├── logging/           # JSON runtime logging
│   └── storage/           # SQLite persistence
├── frontend/              # React + TypeScript frontend
├── DESIGN.md              # Architecture and design decisions
└── docs/                  # Development documentation
```

## Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a feature branch.
2. Implement the change and add relevant tests.
3. Run `make check` to verify tests, checks, and builds.
4. Open a pull request with a clear description of the change.

Before contributing, read [DESIGN.md](DESIGN.md), [AGENTS.md](AGENTS.md), and the [commenting guide](docs/COMMENTING.md).

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgements

Many thanks to JetBrains for providing me with a license to work on this project and other open-source projects.

[![JetBrains](https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.svg)](https://www.jetbrains.com/?from=https://github.com/liangguifeng)
