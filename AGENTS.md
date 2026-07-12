# LogGopher Agent Guide

## Mission

Build a secure, cross-platform desktop log explorer. Preserve the unified domain contract; vendor-specific SDK types must stay inside `internal/adapter`.

## Architecture rules

- `app.go` is a thin Wails boundary. Business rules belong in `internal/application`.
- Frontend code never imports vendor SDK concepts.
- Every adapter implements `Info`, `Connect`, and `Query`, respects context cancellation, and maps responses into `internal/domain`.
- SQLite stores non-secret metadata only. Persist AK/SK exclusively through `internal/credential`; never log or return secrets to the frontend.
- Use parameterized SQL. Add migrations for schema changes and test them in memory.
- Return explicit errors for unsupported functionality; never return synthetic cloud data.

## Commands before handoff

### Go toolchain

- This project requires Go 1.25 and currently pins `go1.25.10` in `go.mod`.
- Use the GOROOT configured for this project in GoLand. Do not silently fall
  back to the system Go installation or rely on automatic toolchain download.
- On the current macOS workstation, GoLand 2026.1 registers the project
  toolchain at
  `$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.25.10.darwin-arm64`.
- Resolve the active GoLand SDK when the workstation configuration changes,
  then invoke Go commands through `$GOROOT/bin/go`. Confirm with
  `$GOROOT/bin/go version` before validation.

```bash
GOROOT="$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.25.10.darwin-arm64"
"$GOROOT/bin/gofmt" -w .
GOTOOLCHAIN=local "$GOROOT/bin/go" test ./...
GOTOOLCHAIN=local "$GOROOT/bin/go" vet ./...
cd frontend && npm run build
```

For UI changes, also verify the Wails window at 1024×680 and 1440×900. Update `README.md` for user-facing behavior and `DESIGN.md` for architecture or security decisions.

## Near-term roadmap

Aliyun SLS, the OS credential store, and Tencent CLS are implemented. Continue with AWS CloudWatch, then add cross-provider error classification and pagination refinements. Every adapter change needs unit tests around request mapping, pagination, timeout, error handling, and result normalization. Never add synthetic provider data as a fallback.
