# Technology Stack

**Analysis Date:** 2026-04-18

## Languages

**Primary:**
- TypeScript 5.7.x (API) / ~5.9.x (web) — all backend and frontend code
- SQL — Prisma migrations and raw queries (`apps/api/prisma/migrations/`)

**Secondary:**
- JavaScript — config scripts (`cleanup.js`, `check-sku.js`)

## Runtime

**Environment:**
- Node.js 20 (LTS) — pinned in `apps/api/Dockerfile` (`node:20-bookworm-slim`)

**Package Manager:**
- npm workspaces (monorepo root `package.json`)
- Lockfile: `package-lock.json` present at monorepo root
- Each app has its own `package.json` within the `apps/*` workspace

## Monorepo Structure

- Root: `package.json` with `"workspaces": ["apps/*"]`
- `apps/api/` — NestJS backend
- `apps/web/` — React frontend

## Frameworks

**Backend (API):**
- NestJS 11.x — `apps/api/package.json` (`@nestjs/common`, `@nestjs/core` ^11.0.1)
  - `@nestjs/jwt` ^11.0.2 — JWT token issuing and verification
  - `@nestjs/passport` ^11.0.5 — Passport.js integration
  - `@nestjs/platform-express` ^11.0.1 — Express HTTP adapter
  - `@nestjs/serve-static` ^5.0.4 — static file serving for uploads

**Frontend (web):**
- React 19.x (`react` ^19.2.0) — `apps/web/package.json`
- React Router DOM 7.x (`react-router-dom` ^7.13.1) — client-side routing
- Recharts 3.x (`recharts` ^3.7.0) — analytics charts

**Build/Dev:**
- Vite 7.x (`vite` ^7.3.1) — frontend dev server and build tool, config: `apps/web/vite.config.ts`
- `@vitejs/plugin-react` ^5.1.1 — React JSX transform
- `@tailwindcss/vite` ^4.2.1 — Tailwind CSS v4 integration via Vite plugin
- `nest-cli` ^11.0.0 — NestJS build and project management, config: `apps/api/nest-cli.json`
- `concurrently` ^8.2.2 — parallel dev server startup from monorepo root

**CSS:**
- Tailwind CSS 4.x (`tailwindcss` ^4.2.1) — utility-first CSS, config: `apps/web/tailwind.config.js`
- PostCSS 8.x — CSS processing, config: `apps/web/postcss.config.js`

**Testing:**
- Jest 30.x (`jest` ^30.0.0) — API unit tests and e2e tests
- `ts-jest` ^29.2.5 — TypeScript transformer for Jest
- `supertest` ^7.0.0 — HTTP integration test helper
- `@nestjs/testing` ^11.0.1 — NestJS test module utilities
- Jest config embedded in `apps/api/package.json`, e2e config: `apps/api/test/jest-e2e.json`

## Key Dependencies

**Critical:**
- `@prisma/client` ^5.21.1 — database client (generated, used everywhere in API)
- `prisma` ^5.21.1 (dev) — CLI for migrations and schema management
- `axios` ^1.13.6 — HTTP client used in both API (`apps/api`) and web (`apps/web`) for marketplace API calls and frontend API requests
- `passport` ^0.7.0 + `passport-jwt` ^4.0.1 — JWT-based authentication strategy

**Security:**
- `bcrypt` ^6.0.0 — password hashing (`apps/api`)
- `helmet` ^8.1.0 — HTTP security headers
- `cookie-parser` ^1.4.7 — cookie handling for auth tokens

**Validation:**
- `class-validator` ^0.15.1 — DTO validation decorators
- `class-transformer` ^0.5.1 — request body transformation via `ValidationPipe`

**Data/Utilities:**
- `date-fns` ^2.30.0 — date formatting (frontend)
- `lucide-react` ^0.576.0 — icon library (frontend)
- `multer` ^2.0.2 — file upload middleware (product images)
- `rxjs` ^7.8.1 — reactive streams (NestJS internal dependency)

## Configuration

**Environment:**
- API env vars loaded from `apps/api/.env` (referenced in `docker-compose.yml` via `env_file`)
- `dotenv` ^16.6.1 (dev dep) — used in scripts/seed
- Key required env vars:
  - `DATABASE_URL` — PostgreSQL connection string
  - `JWT_SECRET` — JWT signing secret
  - `CORS_ORIGIN` — comma-separated production origins
  - `PORT` — API HTTP port (default 3000)
  - `IS_WORKER` — `"true"` activates background sync process
  - `MAX_BOT_TOKEN` — VK Max messenger bot token (optional)
  - `MAX_ENABLED` — `"true"` to enable Max notifications (optional)
- Frontend build-time var: `VITE_API_URL` (injected via Docker build arg, default `/api`)

**Build:**
- API TypeScript config: `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`
  - Target: ES2023, decorators enabled (`emitDecoratorMetadata`, `experimentalDecorators`)
- Web TypeScript config: `apps/web/tsconfig.app.json`, `apps/web/tsconfig.node.json`
- API ESLint config: `apps/api/eslint.config.mjs`
- Web ESLint config: `apps/web/eslint.config.js`

## Platform Requirements

**Development:**
- Node.js 20+
- npm (workspaces support required)
- PostgreSQL 15+ (or use Docker Compose)
- Docker + Docker Compose (for full local stack)

**Production:**
- Docker (multi-stage builds in `apps/api/Dockerfile` and `apps/web/Dockerfile`)
- Docker Compose config: `docker-compose.yml` (4 services: postgres, api, worker, web)
- Nginx (serves React SPA and proxies `/api` and `/uploads` to backend container)
- PostgreSQL 15 (`postgres:15-alpine` image)
- API exposed on port 3000, web on port 80

---

*Stack analysis: 2026-04-18*
