# Architecture

**Analysis Date:** 2026-04-18

## Pattern Overview

**Overall:** Multi-tenant monolith (NestJS API) + SPA frontend (React/Vite) in npm workspaces monorepo

**Key Characteristics:**
- Shared-schema multi-tenancy: all tenants in one PostgreSQL database, every business entity carries a `tenantId` foreign key
- Module-per-domain architecture inside NestJS — each domain is a NestJS module with controller, service, and optional DTOs
- Global `JwtAuthGuard` enforces authentication on all routes by default; individual routes opt out with `@Public()` decorator
- Worker mode: the same NestJS application module can run as an HTTP API (`src/main.ts`) or as a background-only worker (`src/worker.ts`) controlled by `IS_WORKER=true` env var
- Tenant resolved from JWT: `JwtStrategy.validate()` injects `tenantId` from the user's first membership into `req.user.tenantId` — every controller reads it from there and passes it to the service layer

## Layers

**HTTP Controllers:**
- Purpose: Validate HTTP input, extract `req.user.tenantId`, call service, return response
- Location: `apps/api/src/modules/*/`
- Contains: `*.controller.ts` files decorated with `@Controller`, `@Get`, `@Post`, etc.
- Depends on: Service layer in same module
- Used by: NestJS router, HTTP clients

**Service Layer:**
- Purpose: All business logic, data orchestration, marketplace API calls
- Location: `apps/api/src/modules/*/`
- Contains: `*.service.ts` files decorated with `@Injectable()`
- Depends on: `PrismaService` (global), other services (injected explicitly via module imports)
- Used by: Controllers in same module

**Data Access (Prisma):**
- Purpose: Single database client, used directly in all services — no repository layer
- Location: `apps/api/src/prisma/` — `prisma.module.ts`, `prisma.service.ts`
- Contains: `PrismaService extends PrismaClient implements OnModuleInit`
- Depends on: PostgreSQL via `DATABASE_URL`
- Used by: Every service module (PrismaModule is `@Global()`)

**Schema:**
- Location: `apps/api/prisma/schema.prisma`
- Key models: `Tenant`, `User`, `Membership`, `MarketplaceAccount`, `Product`, `MarketplaceOrder`, `MarketplaceReport`, `AuditLog`

**React SPA (web):**
- Purpose: Frontend UI served from Vite; communicates with API via axios
- Location: `apps/web/src/`
- Contains: pages, layouts, contexts
- Depends on: `/api/*` endpoints via axios (baseURL = `VITE_API_URL` or `/api`)

## Multi-Tenancy Model

All business data is isolated by `tenantId`:
- `Product`, `MarketplaceOrder`, `AuditLog`, `MarketplaceAccount`, `MarketplaceReport` all have `tenantId` foreign key pointing to `Tenant`
- `User` is tenant-independent; tenant membership is via `Membership` join table (userId + tenantId + role)
- JWT payload: `{ email, sub: userId, tenantId }` — tenantId is the user's first membership's tenant
- Current limitation: `JwtStrategy` takes `memberships[0].tenantId` — no support for switching tenants or multi-tenant users

```typescript
// apps/api/src/modules/auth/jwt.strategy.ts
(result as any).tenantId = user.memberships?.[0]?.tenantId;
```

## Data Flow

**Standard API Request Flow:**
1. HTTP request arrives → `JwtAuthGuard` extracts JWT from `Authentication` cookie or `Authorization` header
2. `JwtStrategy.validate()` loads full user + memberships, populates `req.user.tenantId`
3. Controller method receives `@Req() req` and passes `req.user.tenantId` to service
4. Service queries `PrismaService` scoped by `tenantId`
5. Response returned directly (no serialization layer)

**Marketplace Sync Flow (background):**
1. `SyncService.onModuleInit()` fires when `IS_WORKER=true`
2. Polls all tenants every 60 seconds via `setInterval`
3. Per-tenant: `syncStore()` → `pullFromWb()` + `pullFromOzon()` + `processWbOrders()` + `processOzonOrders()` + `syncProductMetadata()`
4. WB pull: fetches FBS stocks from `marketplace-api.wildberries.ru`, reconciles mismatches, pushes corrections back
5. Ozon pull: fetches stocks from `api-seller.ozon.ru/v4/product/info/stocks`, reconciles mismatches, pushes corrections back
6. Order processing: deducts `Product.total`, creates `AuditLog`, stores `MarketplaceOrder`
7. Ping-pong prevention: in-memory `Map<productId, {wb?: timestamp, ozon?: timestamp}>` with 2-minute cooldown

**Full Sync Flow (manual trigger):**
1. Controller `POST /sync/full` → `SyncService.fullSync(tenantId)`
2. Phase 0: Import new products from WB (`importProductsFromWb`) and Ozon (`importProductsFromOzon`)
3. Phase 1: Pull current stocks from both marketplaces
4. Phase 2: Pull order history (last 30 days)
5. Phase 3: Sync product metadata (names, photos, ratings)

**Stock Write-Through:**
- Inventory changes (order deduction, manual adjustment) update `Product.total` in PostgreSQL
- Immediately after any `Product.total` change, `syncProductToMarketplaces(productId, tenantId)` pushes new available stock to both WB and Ozon

**Registration Flow:**
1. `POST /auth/register` → `UserService.registerUser()`
2. Prisma transaction: creates `Tenant`, creates `User` with bcrypt password, creates `Membership` (role: OWNER)
3. JWT signed, returned in `Authentication` httpOnly cookie + response body

## Key Abstractions

**Tenant (Company):**
- Purpose: Top-level multi-tenancy boundary; every data entity belongs to a tenant
- Examples: `apps/api/prisma/schema.prisma` model `Tenant`
- Pattern: All service methods accept `tenantId: string` as first parameter, used in all Prisma `where` clauses

**MarketplaceAccount:**
- Purpose: Stores API credentials per marketplace (WB or OZON) per tenant
- Examples: `apps/api/prisma/schema.prisma` model `MarketplaceAccount`
- Pattern: `SyncService.getSettings(tenantId)` assembles credentials from `MarketplaceAccount` rows

**Product:**
- Purpose: Central inventory item; bridges internal warehouse with marketplace listings
- Key fields: `total` (internal stock), `wbFbs`/`wbFbo`/`ozonFbs`/`ozonFbo` (cached marketplace stocks), `wbBarcode` (WB identifier), `sku` (internal + Ozon offer_id)
- Soft-deleted via `deletedAt` field; `findAll` queries filter `deletedAt: null`

**AuditLog:**
- Purpose: Append-only log of all stock changes
- Written by: `ProductService` (manual edits), `SyncService` (order deductions, cancellation refunds)
- Read by: `AuditService.getLogs()` → `GET /audit`

## Entry Points

**API Server:**
- Location: `apps/api/src/main.ts`
- Triggers: `node dist/main` (prod), `nest start --watch` (dev)
- Responsibilities: HTTP server on `PORT` (default 3000), CORS, cookie-parser, helmet, global `ValidationPipe`, global prefix `/api`, `ServeStaticModule` for `uploads/`

**Worker Process:**
- Location: `apps/api/src/worker.ts`
- Triggers: `node dist/src/worker.js` (prod), `nest start --entryFile worker` (dev)
- Responsibilities: Sets `IS_WORKER=true`, boots same `AppModule` as ApplicationContext (no HTTP), activates background polling in `SyncService.onModuleInit()`

**Web SPA:**
- Location: `apps/web/src/main.tsx`
- Entry component: `apps/web/src/App.tsx`
- Responsibilities: React Router v7, wraps all authenticated routes in `PrivateRoute` backed by `AuthContext`, supports Telegram WebApp auto-login

## Error Handling

**Strategy:** Exceptions bubble up; NestJS default exception filter converts to HTTP errors

**Patterns:**
- Service throws NestJS built-in exceptions: `BadRequestException`, `NotFoundException`, `UnauthorizedException`
- Marketplace API errors caught in `try/catch`, logged via `Logger`, `updateMarketplaceStatus()` persists error string to `MarketplaceAccount.lastSyncError`
- Worker sync errors are caught per-tenant in the loop — one tenant failure does not stop others

## Authentication

**Mechanism:** JWT in httpOnly cookie (`Authentication`) + fallback Bearer token header
- Cookie extraction: `ExtractJwt.fromExtractors([cookieExtractor || bearerExtractor])`
- Secret: `process.env.JWT_SECRET` (fallback: `'super-secret-key-change-me'` — insecure default)
- Expiry: 7 days; no refresh token mechanism
- Telegram auth: validates Telegram `initData` HMAC against `TELEGRAM_BOT_TOKEN`, links to existing account

**Global Guard:**
- `JwtAuthGuard` registered as `APP_GUARD` in `AppModule` — applies to all routes
- Routes marked `@Public()` skip the guard (login, register, telegram endpoints)

## Cross-Cutting Concerns

**Logging:** NestJS `Logger` per service (`new Logger(ClassName.name)`); no structured logging or external sink
**Validation:** Global `ValidationPipe` with `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true`; DTOs use `class-validator` decorators
**File Uploads:** Multer with `diskStorage` to `./uploads/` directory; served at `/uploads/*` via `ServeStaticModule`
**Notifications:** `MaxNotifierService` sends messages to MAX (VK Teams-compatible messenger) via `platform-api.max.ru` — enabled only when `MAX_ENABLED=true`

---

*Architecture analysis: 2026-04-18*
