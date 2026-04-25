# Architecture

**Analysis Date:** 2026-04-25

## Pattern

**Монорепо (npm workspaces)** с NestJS-монолитом на бэкенде и React SPA на фронтенде.

```
apps/api     — NestJS 11 модульный монолит (REST API)
apps/web     — React 19 + Vite SPA
packages/shared — общие типы, DTO
```

Развёртывание: 4 Docker-контейнера (`postgres`, `api`, `worker`, `web/nginx`).

## Application Layers

### Backend (apps/api)

```
HTTP Request
    ↓
Global Middlewares (CORS, cookies, logging)
    ↓
JwtAuthGuard (global APP_GUARD, opt-out via @Public())
    ↓
Controller (route handlers, @Body() validation via class-validator)
    ↓
Service (бизнес-логика, multi-tenancy enforcement)
    ↓
PrismaService (прямой доступ к БД, нет отдельного repository-слоя)
    ↓
PostgreSQL 15
```

### Worker Process

- Тот же codebase (`apps/api/src/worker.ts`)
- Запускается с `IS_WORKER=true` — HTTP-листенер не поднимается
- Активирует `SyncService`: polling-петля для синхронизации WB/Ozon
- Работает независимо от API-процесса

### Frontend (apps/web)

```
React Router (навигация)
    ↓
Page Components (страницы)
    ↓
Context Providers (AuthContext, TenantContext и др.)
    ↓
API Client (axios, базовый URL из env)
    ↓
REST API (apps/api)
```

## Module Structure (NestJS)

Каждый доменный модуль в `apps/api/src/modules/<name>/` содержит:
- `<name>.module.ts` — NestJS-модуль, DI-конфигурация
- `<name>.controller.ts` — HTTP-эндпоинты
- `<name>.service.ts` — бизнес-логика
- `<name>.dto.ts` — DTO (class-validator декораторы)

Все модули регистрируются в `AppModule`.

## Key Abstractions

| Абстракция | Описание |
|------------|---------|
| `Tenant` | Организация (компания селлера), корень multi-tenancy |
| `Membership` | Связь User ↔ Tenant с ролью (Owner, Admin, Member) |
| `MarketplaceAccount` | Аккаунт WB или Ozon привязанный к Tenant |
| `Product` | Товар в каталоге (soft-delete через `deletedAt`) |
| `AuditLog` | Лог изменений по каждому Tenant |

## Authentication & Authorization

- **Guard:** `JwtAuthGuard` применён глобально через `APP_GUARD`
- **Opt-out:** `@Public()` декоратор для публичных эндпоинтов
- **JWT:** httpOnly cookies (access + refresh токены)
- **Telegram:** HMAC-SHA256 валидация `initData`
- **Multi-tenancy:** `tenantId` извлекается из `req.user.memberships[0]` в каждом сервисе

## Data Flow: Auth

```
POST /auth/login → AuthController → AuthService
→ validate user credentials
→ issue JWT access token (httpOnly cookie, 15min)
→ issue refresh token (httpOnly cookie, 30d)
```

## Data Flow: Marketplace Sync

```
Worker SyncService (cron/polling)
→ перебирает MarketplaceAccount записи
→ вызывает WbApiClient / OzonApiClient
→ upsert данных через PrismaService
→ пишет SyncLog с результатом
```

## Data Flow: Standard Request

```
Authenticated request → Controller
→ Service получает tenantId из user context
→ все Prisma-запросы фильтруются по tenantId
→ Response DTO (class-transformer)
```

## Entry Points

| Файл | Описание |
|------|---------|
| `apps/api/src/main.ts` | Старт NestJS приложения |
| `apps/api/src/worker.ts` | Старт worker-процесса |
| `apps/api/src/app.module.ts` | Корневой модуль |
| `apps/web/src/main.tsx` | Старт React приложения |

---

*Architecture analysis: 2026-04-25*
*Update after major structural changes*
