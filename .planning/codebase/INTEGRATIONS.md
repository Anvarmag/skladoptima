# External Integrations

**Analysis Date:** 2026-04-18

## APIs & External Services

**Wildberries (WB) Marketplace:**
- Purpose: Stock pull/push (FBS/FBO), order ingestion, product import, seller info
- HTTP client: `axios` (direct REST calls, no SDK)
- Auth: Bearer token in `Authorization` header
- Env vars: `wbApiKey` (from `MarketplaceAccount.apiKey`), `wbStatApiKey` (from `MarketplaceAccount.statApiKey`), `wbWarehouseId` (from `MarketplaceAccount.warehouseId`)
- Endpoints used (hardcoded in `apps/api/src/modules/marketplace_sync/sync.service.ts`):
  - `PUT https://marketplace-api.wildberries.ru/api/v3/stocks/{warehouseId}` — push FBS stock
  - `POST https://marketplace-api.wildberries.ru/api/v3/stocks/{warehouseId}` — pull FBS stock
  - `GET https://marketplace-api.wildberries.ru/api/v3/warehouses` — list seller warehouses
  - `GET https://marketplace-api.wildberries.ru/api/v3/orders/new` — fetch new orders
  - `GET https://marketplace-api.wildberries.ru/api/v3/orders` — fetch historical orders
  - `GET https://statistics-api.wildberries.ru/api/v1/supplier/stocks` — pull FBO stocks
  - `GET https://common-api.wildberries.ru/api/v1/seller-info` — connection test
  - `POST https://content-api.wildberries.ru/content/v2/get/cards/list` — product card import and metadata sync

**Ozon Marketplace:**
- Purpose: Stock pull/push (FBS/FBO), order ingestion, product import, metadata sync
- HTTP client: `axios` (direct REST calls, no SDK)
- Auth: `Client-Id` and `Api-Key` headers
- Env vars: `ozonClientId` (from `MarketplaceAccount.clientId`), `ozonApiKey` (from `MarketplaceAccount.apiKey`), `ozonWarehouseId` (from `MarketplaceAccount.warehouseId`)
- Endpoints used (hardcoded in `apps/api/src/modules/marketplace_sync/sync.service.ts`):
  - `POST https://api-seller.ozon.ru/v2/products/stocks` — push FBS stock
  - `POST https://api-seller.ozon.ru/v4/product/info/stocks` — pull FBS/FBO stocks
  - `POST https://api-seller.ozon.ru/v3/posting/fbs/list` — fetch FBS orders (with filter)
  - `POST https://api-seller.ozon.ru/v3/posting/fbs/get` — get order details
  - `POST https://api-seller.ozon.ru/v1/warehouse/list` — connection test / warehouse list
  - `POST https://api-seller.ozon.ru/v2/product/list` — product list import
  - `POST https://api-seller.ozon.ru/v2/product/info/list` — product detail import
  - `POST https://api-seller.ozon.ru/v3/product/info/list` — product metadata sync
  - `POST https://api-seller.ozon.ru/v3/finance/transaction/list` — finance reports (used in `apps/api/src/modules/finance/finance.service.ts`)

**VK Max Messenger (max-notifier):**
- Purpose: Push notifications to users via VK Max bot
- HTTP client: `axios` instance in `apps/api/src/modules/max-notifier/max-notifier.service.ts`
- Base URL: `https://platform-api.max.ru`
- Auth: `Bearer {MAX_BOT_TOKEN}` header
- Env vars: `MAX_BOT_TOKEN`, `MAX_ENABLED` (`"true"` to activate)
- Endpoints used:
  - `GET /me` — token validation
  - `POST /messages` — send message to chat
- Feature-flagged: disabled by default unless `MAX_ENABLED=true`

## Data Storage

**Databases:**
- PostgreSQL 15
  - Connection: `DATABASE_URL` env var (`postgresql://user:pass@host:5432/dbname?schema=public`)
  - Client: Prisma ORM (`@prisma/client` ^5.21.1)
  - Schema: `apps/api/prisma/schema.prisma`
  - Migrations: `apps/api/prisma/migrations/`
  - Seed script: `apps/api/prisma/seed.ts` (run via `ts-node`)
  - Docker volume: `postgres_data` (persistent)

**File Storage:**
- Local filesystem — product images uploaded via `multer` are stored in `apps/api/uploads/`
- Docker volume: `uploads_data` mounted at `/app/uploads`
- Served as static files via `@nestjs/serve-static`
- No cloud storage (S3/GCS/etc.) detected

**Caching:**
- In-memory only — `SyncService` maintains a `Map<productId, {wb?, ozon?}>` for push cooldown tracking (`lastPush`, 2-minute TTL)
- No Redis or external cache layer detected

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication (no third-party auth provider)
- Implementation: `apps/api/src/modules/auth/` (`AuthService`, `AuthController`, `JwtStrategy`)
  - JWT issued on login, 7-day expiry
  - `@nestjs/jwt` ^11.0.2 for token signing/verification
  - `passport-jwt` ^4.0.1 strategy for route guards
  - Passwords hashed with `bcrypt` ^6.0.0
  - JWT secret: `JWT_SECRET` env var (default `'super-secret-key-change-me'`)
- User model: `apps/api/prisma/schema.prisma` → `User` (email + password + optional `telegramId`)
- Multi-tenancy: `Membership` model links users to tenants with roles (`OWNER`, `ADMIN`, `MANAGER`, `STAFF`)
- Marketplace credentials stored per-tenant in `MarketplaceAccount` table (not user-level)

## Monitoring & Observability

**Error Tracking:**
- No external error tracking service detected (no Sentry, Datadog, etc.)

**Logs:**
- NestJS built-in `Logger` class used throughout all services (e.g., `new Logger(SyncService.name)`)
- Logs go to stdout/stderr — captured by Docker

**Health Checks:**
- `apps/api/src/health/` — health endpoint at `GET /api/health`
- Docker Compose healthcheck polls `http://localhost:3000/api/health` every 15s with 30s start period

## CI/CD & Deployment

**Hosting:**
- Self-hosted Docker Compose deployment (no cloud-managed service detected)
- Docker Compose: `docker-compose.yml` at monorepo root
- 4 services: `postgres` (db), `api` (NestJS HTTP), `worker` (NestJS background sync), `web` (nginx + React)

**CI Pipeline:**
- Not detected (no `.github/workflows/`, `.gitlab-ci.yml`, etc. found)

**Background Worker:**
- Dedicated `worker` Docker service runs same API image with `IS_WORKER=true`
- Entry point: `apps/api/src/worker.ts` (creates NestJS ApplicationContext without HTTP listener)
- `SyncService.onModuleInit()` starts polling loop when `IS_WORKER=true` (60s interval)

## Environment Configuration

**Required env vars (API):**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret (must be changed from default in production)
- `NODE_ENV` — `"production"` or `"development"` (affects CORS policy)

**Optional env vars (API):**
- `PORT` — HTTP port (default 3000)
- `CORS_ORIGIN` — comma-separated allowed origins in production (if empty, all origins allowed)
- `IS_WORKER` — `"true"` on worker container only
- `MAX_BOT_TOKEN` — VK Max bot token for notifications
- `MAX_ENABLED` — `"true"` to activate VK Max notifications

**Frontend build-time:**
- `VITE_API_URL` — API base URL injected at Docker build time (default `/api` via nginx proxy)

**Secrets location:**
- `apps/api/.env` — referenced by `docker-compose.yml` via `env_file` directive
- Not committed to git (expected in `.gitignore`)

## Webhooks & Callbacks

**Incoming:**
- None detected — all marketplace data is fetched by polling (pull model), not webhooks

**Outgoing:**
- VK Max `POST /messages` — notification push when configured
- All marketplace API calls are outgoing on a 60-second polling schedule

---

*Integration audit: 2026-04-18*
