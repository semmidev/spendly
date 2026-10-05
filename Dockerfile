# ── Frontend (React SPA) ──────────────────────────────────────────────
FROM oven/bun:1 AS fe
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# ── Backend + embed SPA ───────────────────────────────────────────────
FROM golang:1.27-alpine AS be
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=fe /web/dist ./internal/web/dist
RUN CGO_ENABLED=0 go build -o /api ./cmd/api

# ── Runtime ───────────────────────────────────────────────────────────
FROM gcr.io/distroless/static:nonroot
COPY --from=be /api /app/api
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/app/api"]
