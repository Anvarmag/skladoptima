# Codebase Structure

**Analysis Date:** 2026-04-18

## Directory Layout

```
skladoptima/                    # Monorepo root (npm workspaces)
├── apps/
│   ├── api/                    # NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Database schema (single source of truth)
│   │   │   ├── migrations/     # Prisma migration history
│   │   │   └── seed.ts         # DB seed script
│   │   ├── src/
│   │   │   ├── main.ts         # HTTP server entry point
│   │   │   ├── worker.ts       # Background worker entry point
│   │   │   ├── app.module.ts   # Root NestJS module (imports all feature modules)
│   │   │   ├── app.controller.ts
│   │   │   ├── app.service.ts
│   │   │   ├── health/         # Health check module
│   │   │   ├── prisma/         # Global Prisma module and service
│   │   │   └── modules/        # Feature modules (one per domain)
│   │   │       ├── auth/
│   │   │       ├── users/
│   │   │       ├── tenants/
│   │   │       ├── memberships/
│   │   │       ├── catalog/
│   │   │       ├── inventory/
│   │   │       ├── marketplace/
│   │   │       ├── marketplace_sync/
│   │   │       ├── finance/
│   │   │       ├── analytics/
│   │   │       ├── audit/
│   │   │       └── max-notifier/
│   │   ├── test/               # e2e test specs
│   │   ├── uploads/            # User-uploaded product images (served at /uploads/*)
│   │   ├── dist/               # Compiled output (generated, not committed)
│   │   └── package.json
│   └── web/                    # React + Vite SPA
│       ├── public/
│       ├── src/
│       │   ├── main.tsx        # React entry point
│       │   ├── App.tsx         # Router + route definitions
│       │   ├── index.css
│       │   ├── App.css
│       │   ├── assets/         # Static assets
│       │   ├── context/        # React context providers
│       │   │   └── AuthContext.tsx
│       │   ├── layouts/        # Shared page shell components
│       │   │   └── MainLayout.tsx
│       │   └── pages/          # One file per route/page
│       │       ├── Login.tsx
│       │       ├── Register.tsx
│       │       ├── Products.tsx
│       │       ├── Analytics.tsx
│       │       ├── UnitEconomics.tsx
│       │       ├── History.tsx
│       │       ├── Orders.tsx
│       │       └── Settings.tsx
│       └── package.json
├── .planning/
│   └── codebase/               # Codebase analysis documents
├── STRUCTURE-DEV/
│   └── DOCS/                   # Design docs, business requirements, sprint plans
├── package.json                # Workspace root (concurrently dev script)
├── docker-compose.yml
└── docs/
```

## Directory Purposes

**`apps/api/src/modules/`:**
- Purpose: All feature domain modules, one NestJS module per domain
- Contains: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/` subdirectory
- Key files: see module list below

**`apps/api/src/prisma/`:**
- Purpose: Global Prisma client module — injected into every service
- Key files:
  - `apps/api/src/prisma/prisma.module.ts` — `@Global()` module, exports `PrismaService`
  - `apps/api/src/prisma/prisma.service.ts` — extends `PrismaClient`, `OnModuleInit`

**`apps/api/prisma/`:**
- Purpose: Database schema, migrations, and seed
- Key files:
  - `apps/api/prisma/schema.prisma` — Prisma schema; edit here to change DB models
  - `apps/api/prisma/migrations/` — auto-generated migration SQL; do not edit manually

**`apps/api/uploads/`:**
- Purpose: Local disk storage for product photos uploaded via multipart form
- Generated: At runtime
- Committed: No (should be in `.gitignore`)
- Served: via `ServeStaticModule` at `/uploads/*`

**`apps/web/src/context/`:**
- Purpose: React context providers for shared state
- Current contexts: `AuthContext.tsx` — handles user session, JWT cookie, Telegram WebApp auto-login

**`apps/web/src/layouts/`:**
- Purpose: Page shell components with navigation
- Key file: `MainLayout.tsx` — sidebar (desktop) + bottom nav (mobile) + Telegram BackButton support

**`apps/web/src/pages/`:**
- Purpose: One component per route; contains all page-level business logic and data fetching via axios
- Each page fetches its own data directly with `axios.get('/...')` — no shared data layer/store

**`STRUCTURE-DEV/DOCS/`:**
- Purpose: Planning and design documentation (business requirements, analytics, sprint docs)
- Generated: No
- Committed: Yes

## Key File Locations

**Entry Points:**
- `apps/api/src/main.ts` — HTTP API server bootstrap
- `apps/api/src/worker.ts` — Background worker bootstrap (sets `IS_WORKER=true`)
- `apps/web/src/main.tsx` — React SPA entry

**Module Registration:**
- `apps/api/src/app.module.ts` — Root module; all feature modules imported here

**Database Schema:**
- `apps/api/prisma/schema.prisma` — All Prisma models and enums

**Auth Guard:**
- `apps/api/src/modules/auth/jwt-auth.guard.ts` — Global JWT guard
- `apps/api/src/modules/auth/jwt.strategy.ts` — Passport JWT strategy (cookie + bearer)
- `apps/api/src/modules/auth/public.decorator.ts` — `@Public()` decorator to skip auth

**Configuration:**
- `apps/api/package.json` — API scripts including `start:worker:prod`
- `docker-compose.yml` — Local dev environment

## Module Map (API)

| Module directory | NestJS module file | HTTP prefix | Responsibility |
|---|---|---|---|
| `modules/auth/` | `auth.module.ts` | `/api/auth` | Login, register, JWT, Telegram auth |
| `modules/users/` | `user.module.ts` | (no controller) | User CRUD, tenant+membership creation on register |
| `modules/tenants/` | — | — | (directory exists, minimal/empty) |
| `modules/memberships/` | — | — | (directory exists, minimal/empty) |
| `modules/catalog/` | `product.module.ts` | `/api/products` | Product CRUD, stock adjustment, photo upload |
| `modules/inventory/` | — | — | (directory exists, minimal/empty) |
| `modules/marketplace/` | `settings.module.ts` | `/api/settings` | Marketplace account credentials CRUD, store info |
| `modules/marketplace_sync/` | `sync.module.ts` | `/api/sync` | Marketplace sync (pull/push stocks, orders, metadata) |
| `modules/finance/` | `finance.module.ts` | `/api/finance` | Unit economics calculation, marketplace reports |
| `modules/analytics/` | `analytics.module.ts` | `/api/analytics` | ABC analysis, geo analytics, revenue dynamics |
| `modules/audit/` | `audit.module.ts` | `/api/audit` | Read/write audit log |
| `modules/max-notifier/` | `max-notifier.module.ts` | `/api/max` | MAX messenger notifications |
| `health/` | `health.module.ts` | `/api/health` | Health check endpoint |

## Naming Conventions

**Files:**
- NestJS modules: `<domain>.module.ts` (e.g., `product.module.ts`, `sync.module.ts`)
- Controllers: `<domain>.controller.ts`
- Services: `<domain>.service.ts`
- DTOs: `<action>-<entity>.dto.ts` (e.g., `create-product.dto.ts`, `adjust-stock.dto.ts`) — live in `dto/` subdirectory
- Guards/Strategies: `<name>.guard.ts`, `<name>.strategy.ts`
- Decorators: `<name>.decorator.ts`

**Directories:**
- Module directories: lowercase, hyphen-separated (e.g., `marketplace_sync`, `max-notifier`)
- Web pages: PascalCase single file (e.g., `Products.tsx`, `UnitEconomics.tsx`)

**Database models (Prisma):**
- Model names: PascalCase singular (e.g., `Product`, `MarketplaceOrder`)
- Enum names: PascalCase (e.g., `TaxSystem`, `MarketplaceType`, `ActionType`)
- Field names: camelCase

**API routes:**
- All routes prefixed with `/api` (set globally in `main.ts`)
- Route format: `/api/<resource>` or `/api/<resource>/:id`

## Where to Add New Code

**New domain module:**
1. Create `apps/api/src/modules/<domain>/` directory
2. Add `<domain>.module.ts`, `<domain>.controller.ts`, `<domain>.service.ts`
3. Add DTOs in `dto/` subdirectory
4. Import the new module in `apps/api/src/app.module.ts`
5. Inject `PrismaService` via constructor (no need to import PrismaModule — it is `@Global()`)

**New database model:**
1. Edit `apps/api/prisma/schema.prisma`
2. Run `npm run prisma:migrate -w api`
3. Run `npm run prisma:generate -w api` if needed

**New frontend page:**
1. Create `apps/web/src/pages/<PageName>.tsx`
2. Add route in `apps/web/src/App.tsx` inside the nested `/app` route
3. Add nav link in `apps/web/src/layouts/MainLayout.tsx` (both desktop sidebar and mobile bottom nav)

**New product photo field:**
- Upload via `POST /api/products` multipart; stored to `apps/api/uploads/`
- Path format: `/uploads/<timestamp>-<random><ext>`

**New tenant-scoped feature:**
- All service methods must accept `tenantId: string` and filter all Prisma queries with `where: { tenantId, ... }`
- Never expose data across tenant boundaries

## Special Directories

**`apps/api/dist/`:**
- Purpose: TypeScript compilation output
- Generated: Yes, by `npm run build -w api`
- Committed: No

**`apps/api/uploads/`:**
- Purpose: Uploaded product images
- Generated: Yes, at runtime
- Committed: No

**`.planning/`:**
- Purpose: GSD planning documents (phases, codebase analysis)
- Committed: Yes

**`STRUCTURE-DEV/DOCS/`:**
- Purpose: Product/technical documentation, business requirements, sprint tracking
- Committed: Yes

---

*Structure analysis: 2026-04-18*
