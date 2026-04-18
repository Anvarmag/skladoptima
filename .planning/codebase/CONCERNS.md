# Codebase Concerns

**Analysis Date:** 2026-04-18

## Security Considerations

**Hardcoded JWT fallback secret:**
- Risk: If `JWT_SECRET` env var is not set, auth runs with the literal string `'super-secret-key-change-me'` — any attacker knowing the source can forge tokens.
- Files: `apps/api/src/modules/auth/jwt.strategy.ts` line 21
- Current mitigation: Docs say to set `JWT_SECRET`, but no startup enforcement.
- Recommendation: Add a guard on startup that throws if `JWT_SECRET` is missing or matches the default.

**Admin password logged in plaintext at startup:**
- Risk: Every restart prints `Admin user admin@example.com password updated to <plaintext>` to stdout — visible in Docker logs, log aggregators, CI pipelines.
- Files: `apps/api/src/modules/users/user.service.ts` line 53
- Current mitigation: None.
- Recommendation: Remove the `password` from the log message; log only "Admin password refreshed".

**Default Docker Compose credentials:**
- Risk: `docker-compose.yml` ships with `POSTGRES_PASSWORD: change_me_in_prod` as a default fallback string.
- Files: `docker-compose.yml` lines 9–11
- Current mitigation: Intended to be overridden via `.env`; no enforcement.
- Recommendation: Remove default value so startup fails if password is not explicitly set.

**No file upload validation (type + size):**
- Risk: `multer` in `ProductController` stores files to `./uploads` with no MIME-type filter and no size limit. An attacker can upload arbitrary files (executables, huge archives).
- Files: `apps/api/src/modules/catalog/product.controller.ts` lines 15–23, 54–63
- Current mitigation: Files are served via `ServeStaticModule` at `/uploads/`.
- Recommendation: Add `fileFilter` rejecting non-image MIME types and set `limits.fileSize` (e.g. 5 MB).

**No rate limiting on auth endpoints:**
- Risk: `/api/auth/login`, `/api/auth/register`, `/api/auth/telegram` are publicly accessible with no brute-force protection. No `@nestjs/throttler` or equivalent guard is installed.
- Files: `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/main.ts`
- Current mitigation: None.
- Recommendation: Install `@nestjs/throttler`, apply a strict guard (e.g. 10 req/min) to `@Public()` auth routes.

**CORS wildcard in production when `CORS_ORIGIN` not set:**
- Risk: If `CORS_ORIGIN` is empty in production, `main.ts` falls back to `return callback(null, true)` — allowing any origin.
- Files: `apps/api/src/main.ts` lines 43–44
- Current mitigation: Comment says "nginx уже проксирует", but the API port (3000) is also exposed via `docker-compose.yml`.
- Recommendation: Default to a deny-all when `CORS_ORIGIN` is unset in production; or remove the port 3000 exposure from compose.

**Marketplace API keys stored in plaintext in DB:**
- Risk: `MarketplaceAccount.apiKey`, `statApiKey`, `clientId` are stored unencrypted in PostgreSQL. A DB dump leaks all seller marketplace credentials.
- Files: `apps/api/prisma/schema.prisma` lines 112–115, `apps/api/src/modules/marketplace/settings.service.ts`
- Current mitigation: None.
- Recommendation: Encrypt sensitive key fields at the application layer (AES-256) before writing to DB.

**`/api/auth/telegram/link` is `@Public` and accepts raw password:**
- Risk: The endpoint accepts email+password in the request body over an unauthenticated route. No CSRF protection beyond `sameSite` cookie.
- Files: `apps/api/src/modules/auth/auth.controller.ts` lines 74–96
- Current mitigation: `sameSite: 'none'` for Telegram (explicitly commented), weakening CSRF protection.
- Recommendation: Require existing JWT auth for link/unlink, or add CSRF token validation.

---

## Tech Debt

**`SyncService` god object (1280 lines):**
- Issue: All WB and Ozon API interactions, order processing, metadata sync, product import, history pull, and background polling live in a single class.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts`
- Impact: Hard to test, unit-test impossible without full Prisma mock; any change touches everything.
- Fix approach: Split into `WbSyncService`, `OzonSyncService`, `OrderProcessorService`, `ProductImportService`. Background polling moves to a dedicated `SyncSchedulerService`.

**Pervasive `any` typing (89 occurrences across 15 API files):**
- Issue: Method signatures use `any` for settings objects, request payloads, and Prisma results throughout the API.
- Files: All files in `apps/api/src/modules/` — worst offenders: `sync.service.ts` (46), `product.controller.ts` (7), `auth.controller.ts` (7).
- Impact: TypeScript safety nullified; bugs hidden at compile time surface at runtime.
- Fix approach: Define typed interfaces for `MarketplaceSettings`, `WbCard`, `OzonItem`, etc. Replace `any` incrementally starting with `sync.service.ts`.

**`$executeRawUnsafe` for basic field updates:**
- Issue: Two raw SQL calls in `SyncService` update `wbFbs` and `ozonFbs` columns via `$executeRawUnsafe(UPDATE "Product" SET ...)` rather than `prisma.product.update`.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 144, 186
- Impact: Bypasses Prisma's type safety; risks SQL injection if input ever changes; inconsistent ORM usage.
- Fix approach: Replace with `prisma.product.update({ where: { id }, data: { wbFbs: amount } })`.

**`SettingsService.updateSettings` accepts `dto: any`:**
- Issue: The flat legacy DTO (`wbApiKey`, `ozonClientId`, etc.) was kept during a migration to `MarketplaceAccount`. Typed DTO class does not exist.
- Files: `apps/api/src/modules/marketplace/settings.service.ts` line 49, `apps/api/src/modules/marketplace/dto/update-settings.dto.ts`
- Impact: Validation pipe cannot enforce types; accidental field overwrite is possible.
- Fix approach: Create a typed `UpdateSettingsDto` with `class-validator` decorators.

**`tenantId` populated by taking `memberships[0]` in JWT strategy:**
- Issue: A user with multiple memberships will always get the first tenant's context; switching tenants is not supported.
- Files: `apps/api/src/modules/auth/jwt.strategy.ts` line 33
- Impact: Multi-tenant feature (documented in schema with `Membership` table) is unusable as designed.
- Fix approach: Pass `tenantId` explicitly in JWT payload at login; or add a `X-Tenant-Id` header mechanism.

**`importMarketplaceReport` is a stub:**
- Issue: Method logs and returns `{ success: true, count: 0 }` with no implementation.
- Files: `apps/api/src/modules/finance/finance.service.ts` lines 126–130
- Impact: Financial report import feature is non-functional; any UI flow relying on it silently succeeds with empty results.
- Fix approach: Implement WB v5 report parser or mark endpoint as `501 Not Implemented`.

**`pullHistoryFromWb` does not pull history:**
- Issue: Method comment says "Pulling orders (marketplace-api doesn't give deep history easily)" but simply calls `processWbOrders`, which only fetches new orders.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 1094–1106
- Impact: Full sync does not populate order history for WB; analytics are incomplete.
- Fix approach: Use WB Statistics API `/api/v1/supplier/orders` with a date range, or document the limitation clearly.

**`onModuleInit` in `SyncService` uses `setInterval` without cleanup:**
- Issue: The worker background loop is started with `setTimeout` wrapping `setInterval` inside `onModuleInit`. No `onModuleDestroy` clears the interval handle.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 16–43
- Impact: Memory leak on module reload during tests; potential double-execution if NestJS reinitializes.
- Fix approach: Store the interval reference, implement `OnModuleDestroy` to clear it.

**`lastPush` ping-pong map is in-process memory:**
- Issue: The cooldown state (`Map<string, { wb?, ozon? }>`) is instance-scoped — cleared on worker restart, invisible to the API process.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 11–12
- Impact: After a worker restart, the 2-minute cooldown resets and a push storm can occur.
- Fix approach: Move cooldown state to Redis or a DB column with a timestamp.

---

## Performance Bottlenecks

**N+1 queries in `getRecommendations`:**
- Problem: For each product, for each marketplace (2), a separate `findMany` on `marketplaceOrder` is executed — up to `N * 2` DB queries per request.
- Files: `apps/api/src/modules/analytics/analytics.service.ts` lines 15–32
- Cause: Individual queries inside a nested loop with no batching.
- Improvement path: Load all orders for the tenant in one query, group in memory by `productSku + marketplace`.

**N+1 queries in `getRevenueDynamics`:**
- Problem: 15 days × 2 marketplaces = 30 separate DB aggregate queries per request.
- Files: `apps/api/src/modules/analytics/analytics.service.ts` lines 106–145
- Improvement path: Use a single raw SQL query grouping by date and marketplace.

**N+1 queries in `calculateUnitEconomics`:**
- Problem: For each product × marketplace, one `findMany` on orders is issued in a loop.
- Files: `apps/api/src/modules/finance/finance.service.ts` lines 36–44
- Improvement path: Single bulk query grouped by `productSku, marketplace`, mapped in memory.

**Unbounded `findMany` calls in sync:**
- Problem: `SyncService.syncStore` calls `prisma.product.findMany` with no `take` limit for product lists loaded into memory. At scale (10k+ products per tenant) this exhausts Node.js heap.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 235, 253, 340, 375, 417, 825
- Improvement path: Process products in cursor-paginated batches of 500.

**Sequential per-product DB writes during order processing:**
- Problem: `processWbOrders` and `processOzonOrders` perform individual `prisma.product.update` and `prisma.auditLog.create` for every order line in a loop — no batching or transaction.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 629–668, 764–784
- Improvement path: Use `prisma.$transaction` with batched writes, or `updateMany` with `CASE` expressions.

---

## Fragile Areas

**Order deduplication via `marketplaceOrderId` string comparison:**
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 589, 703
- Why fragile: If the same order ID appears on two marketplaces (unlikely but possible edge case), the dedup check uses `{ marketplaceOrderId: orderId, tenantId }` without the `marketplace` field — a WB order could suppress an Ozon order with the same ID.
- Safe modification: Add `marketplace` to the `findFirst` where clause.
- Test coverage: No unit tests exist; behavior verified only in production.

**Stock decrement without distributed lock:**
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 629, 765
- Why fragile: Two concurrent sync cycles (API + worker can run simultaneously) could both decrement stock for the same order before the dedup record is written.
- Safe modification: Wrap the check-and-decrement in a DB transaction; create the `MarketplaceOrder` record before modifying stock.

**`ProductController.importProducts` route conflict:**
- Files: `apps/api/src/modules/catalog/product.controller.ts` line 87
- Why fragile: `@Post('import')` is defined after `@Post(':id/stock-adjust')`. Express route matching could misroute `/import` as a product ID. NestJS resolves static paths before parameterized ones, but the `stock-adjust` suffix avoids the conflict — this is non-obvious and brittle if routes are reordered.
- Safe modification: Move import to a dedicated controller or prefix: `@Post('bulk/import')`.

---

## Test Coverage Gaps

**Business-critical sync logic has zero tests:**
- What's not tested: WB/Ozon stock pull, order deduction, ping-pong prevention, full sync, product import.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` (1280 lines)
- Risk: Silent stock corruption, double-deduction, or infinite reconcile loops undetected until production.
- Priority: High

**Auth service has zero tests:**
- What's not tested: `validateUser`, JWT login, Telegram signature verification, account linking/unlinking.
- Files: `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/jwt.strategy.ts`
- Risk: Auth regressions ship silently.
- Priority: High

**Finance and analytics services have zero tests:**
- What's not tested: Unit economics calculations (tax computation, logistics estimation), ABC classification, revenue dynamics.
- Files: `apps/api/src/modules/finance/finance.service.ts`, `apps/api/src/modules/analytics/analytics.service.ts`
- Risk: Incorrect financial data shown to users without detection.
- Priority: Medium

**Only one test file exists in the entire API:**
- Files: `apps/api/src/app.controller.spec.ts` (auto-generated NestJS scaffold), `apps/api/test/app.e2e-spec.ts`
- Risk: No regression safety net for any production logic.
- Priority: High

---

## Missing Critical Features

**No API pagination for Ozon product import:**
- Problem: `importProductsFromOzon` fetches `limit: 1000` products in a single call with no cursor-based iteration.
- Blocks: Sellers with >1000 Ozon products will silently miss products on import.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` line 1217

**No WB pagination for content cards:**
- Problem: `importProductsFromWb` and `syncProductMetadata` use `cursor: { limit: 100 }` with no loop to fetch subsequent pages.
- Blocks: Sellers with >100 WB cards will have incomplete product catalog.
- Files: `apps/api/src/modules/marketplace_sync/sync.service.ts` lines 843–845, 1157–1159

**No global NestJS exception filter:**
- Problem: Unhandled exceptions from external API calls (axios) will bubble up as 500 responses with stack traces exposed. No `HttpExceptionFilter` or `AllExceptionsFilter` registered.
- Files: `apps/api/src/main.ts`
- Risk: Internal error details (Prisma queries, file paths) leaked to clients.

**`AccessState` enum exists in schema but is never enforced:**
- Problem: `Tenant.accessState` can be `TRIAL_EXPIRED` or `SUSPENDED`, but no middleware or guard checks this value before serving requests.
- Files: `apps/api/prisma/schema.prisma` lines 57, `apps/api/src/modules/auth/jwt.strategy.ts`
- Risk: Expired or suspended tenants continue to use the product.

---

*Concerns audit: 2026-04-18*
