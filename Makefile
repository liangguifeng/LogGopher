WAILS := go run github.com/wailsapp/wails/v2/cmd/wails@v2.10.2

.PHONY: dev build doctor test check

dev:
	$(WAILS) dev

build:
	$(WAILS) build

doctor:
	$(WAILS) doctor

test:
	go test ./...

check:
	go test ./...
	go vet ./...
	cd frontend && npm run build
