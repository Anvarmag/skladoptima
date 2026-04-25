# Technology Stack

**Analysis Date:** 2026-04-25

## Languages

**Primary:**
- TypeScript 5.7/5.9 — весь прикладной код (backend + frontend)

**Secondary:**
- JavaScript — конфиги (jest.config.js, vite.config.ts, webpack)
- SQL — миграции Prisma

## Runtime

**Environment:**
- Node.js — target ES2023, используется в API и worker
- Browser — React 19 (web)

**Package Manager:**
- npm workspaces (монорепо)
- Lockfile: `package-lock.json`

## Monorepo Structure

| Пакет | Путь | Назначение |
|-------|------|------------|
| `api` | `packages/api/` | NestJS backend REST API |
| `web` | `packages/web/` | React 19 + Vite SPA |
| `worker` | `packages/worker/` | Фоновые задачи (синхронизация WB/Ozon) |
| `shared` | `packages/shared/` | Общие типы, DTO, утилиты |

## Frameworks

**Backend:**
- NestJS 11 — основной фреймворк API (модули, DI, декораторы)
- Express — HTTP-транспорт под NestJS
- Passport.js — стратегии аутентификации (JWT, Local)

**Frontend:**
- React 19 — UI
- Vite 7 — сборка и dev-сервер
- React Router — навигация

**ORM / Database:**
- Prisma 5.21 — ORM + миграции
- PostgreSQL 15 — основная БД

**Testing:**
- Jest 30 — unit и интеграционные тесты (api + worker)
- Vitest — тесты frontend (web)

## Key Dependencies

**Critical:**
- `@nestjs/core`, `@nestjs/common` — ядро NestJS
- `@prisma/client` — доступ к БД
- `passport-jwt`, `passport-local` — JWT-аутентификация, httpOnly cookies
- `class-validator`, `class-transformer` — валидация DTO
- `multer` — загрузка файлов (временно, планируется S3)

**Infrastructure:**
- `bull` или `@nestjs/bull` — очереди задач для worker
- `axios` — HTTP-клиент для маркетплейс API

## Configuration

**Environment:**
- `.env` файлы по пакетам (`.env.example` в корне)
- Ключевые переменные: `DATABASE_URL`, `JWT_SECRET`, `WB_API_KEY`, `OZON_CLIENT_ID`, `OZON_API_KEY`, `TELEGRAM_BOT_TOKEN`

**Build:**
- `tsconfig.json` в каждом пакете
- `vite.config.ts` — frontend
- `nest-cli.json` — конфиг NestJS

## Docker

4 контейнера в `docker-compose.yml`:
- `postgres` — PostgreSQL 15
- `api` — NestJS REST API
- `worker` — фоновые задачи
- `web` / `nginx` — React SPA + nginx

## Platform Requirements

**Development:**
- macOS/Linux с Node.js LTS
- Docker + Docker Compose для локальной БД

**Production:**
- Docker-контейнеры
- PostgreSQL 15
- Планируется: S3-совместимое хранилище (per requirements 17-files-s3)

---

*Stack analysis: 2026-04-25*
*Update after major dependency changes*
