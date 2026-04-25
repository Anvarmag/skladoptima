# Directory Structure

**Analysis Date:** 2026-04-25

## Top-Level Layout

```
skladoptima/
├── apps/
│   ├── api/                    # NestJS backend
│   └── web/                    # React frontend
├── packages/
│   └── shared/                 # Общие типы и утилиты
├── STRUCTURE-DEVELOPMENT /     # Проектная документация
│   └── DOCS/
│       ├── BUSINESS-REQUIREMENTS/  # 20 доменных требований
│       ├── TASKS/                  # Декомпозиция задач по модулям
│       └── TOTAL_RULES_IMPORTANT_FOR_AI.MD
├── .planning/                  # GSD планирование
├── docker-compose.yml
├── package.json                # npm workspaces root
└── tsconfig.base.json
```

## Backend (apps/api/)

```
apps/api/
├── src/
│   ├── main.ts                 # Точка входа API
│   ├── worker.ts               # Точка входа Worker
│   ├── app.module.ts           # Корневой модуль
│   ├── modules/                # Доменные модули
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   └── auth.dto.ts
│   │   ├── tenant/
│   │   ├── team/
│   │   ├── catalog/
│   │   ├── inventory/
│   │   ├── warehouses/
│   │   ├── marketplace-accounts/
│   │   ├── sync/               # Worker SyncService
│   │   ├── orders/
│   │   ├── finance/
│   │   ├── analytics/
│   │   ├── billing/
│   │   ├── notifications/
│   │   ├── audit/
│   │   └── files/
│   ├── common/                 # Shared утилиты, guards, decorators
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts
│   │   ├── decorators/
│   │   │   └── public.decorator.ts
│   │   └── filters/
│   └── prisma/
│       └── prisma.service.ts
├── prisma/
│   ├── schema.prisma           # Схема БД
│   └── migrations/             # SQL-миграции
├── test/                       # E2E тесты
├── uploads/                    # Временное хранилище файлов
├── Dockerfile
├── jest.config.js
├── nest-cli.json
├── tsconfig.json
└── package.json
```

## Frontend (apps/web/)

```
apps/web/
├── src/
│   ├── main.tsx                # Точка входа
│   ├── App.tsx                 # Root компонент + роутинг
│   ├── pages/                  # Page-компоненты (по маршрутам)
│   ├── components/             # Переиспользуемые UI-компоненты
│   ├── context/                # React Context (Auth, Tenant и др.)
│   ├── layouts/                # Layout-обёртки
│   ├── hooks/                  # Custom hooks
│   ├── api/                    # API-клиент (axios instance, методы)
│   └── types/                  # Frontend-специфичные типы
├── public/
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Shared Package (packages/shared/)

```
packages/shared/
├── src/
│   ├── types/                  # Общие TypeScript-типы
│   ├── dto/                    # DTO используемые и на backend, и на frontend
│   └── constants/              # Общие константы (roles, statuses и др.)
└── package.json
```

## Key File Locations

| Что | Где |
|-----|-----|
| Prisma-схема | `apps/api/prisma/schema.prisma` |
| Миграции | `apps/api/prisma/migrations/` |
| Env-пример | `.env.example` (корень) |
| Docker | `docker-compose.yml` (корень) |
| Новый NestJS-модуль | `apps/api/src/modules/<name>/` |
| Новая страница | `apps/web/src/pages/<name>/` |
| Бизнес-требования | `STRUCTURE-DEVELOPMENT /DOCS/BUSINESS-REQUIREMENTS/` |

## Naming Conventions

| Артефакт | Паттерн | Пример |
|----------|---------|--------|
| NestJS модуль | `<name>.module.ts` | `auth.module.ts` |
| Контроллер | `<name>.controller.ts` | `auth.controller.ts` |
| Сервис | `<name>.service.ts` | `auth.service.ts` |
| DTO | `<name>.dto.ts` | `auth.dto.ts` |
| Guard | `<name>.guard.ts` | `jwt-auth.guard.ts` |
| Decorator | `<name>.decorator.ts` | `public.decorator.ts` |
| React страница | `<Name>Page.tsx` | `DashboardPage.tsx` |
| React компонент | `<Name>.tsx` (PascalCase) | `ProductCard.tsx` |
| Hook | `use<Name>.ts` | `useAuth.ts` |

---

*Structure analysis: 2026-04-25*
*Update after major directory reorganization*
