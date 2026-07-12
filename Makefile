GO ?= go
WAILS := $(GO) run github.com/wailsapp/wails/v2/cmd/wails@v2.10.2

.PHONY: dev build doctor test test-race coverage check

dev:
	$(WAILS) dev

build:
	$(WAILS) build

doctor:
	$(WAILS) doctor

test:
	$(GO) test ./...
	cd frontend && npm test

test-race:
	$(GO) test -race ./...
	cd frontend && npm test

coverage:
	mkdir -p build/coverage
	$(GO) test -coverprofile=build/coverage/go.out ./...
	$(GO) tool cover -func=build/coverage/go.out | tee build/coverage/go.txt
	@awk '/^total:/ { gsub("%", "", $$3); if ($$3 < 60) { print "Go coverage below 60%: " $$3 "%"; exit 1 } }' build/coverage/go.txt
	cd frontend && npm run test:coverage

check:
	$(GO) test ./...
	$(GO) vet ./...
	cd frontend && npm test
	cd frontend && npm run build
