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

```bash
gofmt -w .
go test ./...
go vet ./...
cd frontend && npm run build
```

For UI changes, also verify the Wails window at 1024×680 and 1440×900. Update `README.md` for user-facing behavior and `DESIGN.md` for architecture or security decisions.

## Near-term roadmap

Implement adapters in this order: Aliyun SLS → OS credential store → Tencent CLS → AWS CloudWatch. Each implementation needs unit tests around request mapping, pagination, timeout, error redaction, and result normalization.
