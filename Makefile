VERSION ?= 0.1.0
BUILD_TIME ?= $(shell date -u +'%Y-%m-%dT%H:%M:%SZ')
GIT_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
MODULE = github.com/semmidev/spendly

LDFLAGS = -ldflags "-X '$(MODULE)/internal/platform/config.Version=$(VERSION)' -X '$(MODULE)/internal/platform/config.BuildTime=$(BUILD_TIME)' -X '$(MODULE)/internal/platform/config.GitCommit=$(GIT_COMMIT)'"

BUN_CMD ?= $(shell command -v bun 2>/dev/null || echo "$(HOME)/.bun/bin/bun")
DOCKER_COMPOSE ?= $(shell command -v docker-compose 2>/dev/null || echo "docker compose")
GO_TEST_PKGS = $(shell go list ./... | grep -v '/node_modules/')

.PHONY: build build-frontend run dev test test-pg lint fmt tidy clean db-up db-down

## Build React SPA dan salin ke direktori embed Go.
build-frontend:
	@echo "🎨 Build frontend (SPA) dengan Bun…"
	@cd web && $(BUN_CMD) install && $(BUN_CMD) run build
	@rm -rf internal/web/dist
	@cp -r web/dist internal/web/dist
	@touch internal/web/dist/.gitkeep
	@echo "✅ Frontend siap di-embed"

## Binary lengkap (frontend + backend).
build: build-frontend
	@mkdir -p bin
	@go build $(LDFLAGS) -o bin/api ./cmd/api
	@echo "✅ Binary: bin/api"

## Jalankan SPA+API dalam satu proses (rebuild frontend dulu).
run: build-frontend
	@echo "🚀 Spendly jalan di http://localhost:$${APP_PORT:-8080}"
	@go run $(LDFLAGS) ./cmd/api

## Jalankan backend cepat tanpa rebuild frontend (pakai dist yang ada).
dev:
	@go run ./cmd/api

test:
	go test -race $(GO_TEST_PKGS)

## Test integrasi Postgres via testcontainers (otomatis skip bila Docker mati).
test-pg:
	go test -race -run 'Integration|PG' $(GO_TEST_PKGS) -v

lint:
	go vet $(GO_TEST_PKGS)

fmt:
	gofmt -w $$(go list -f '{{.Dir}}' ./... | grep -v node_modules)

tidy:
	go mod tidy

clean:
	rm -rf bin/ internal/web/dist
	mkdir -p internal/web/dist && touch internal/web/dist/.gitkeep

## Nyalakan Postgres lokal (butuh DATABASE_URL di .env).
db-up:
	$(DOCKER_COMPOSE) up -d postgres

db-down:
	$(DOCKER_COMPOSE) down
