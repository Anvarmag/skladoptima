# Архитектура Sklad Optima

> **Назначение этого файла:** Быстрый вход в контекст проекта для любого ИИ-ассистента или разработчика. Все подробности вынесены в отдельные файлы этой же папки `docs/`.

---

## Что это за проект

**Sklad Optima** — production-ready MVP веб-сервис для управления складскими остатками с двусторонней интеграцией маркетплейсов **Wildberries** и **Ozon**.

### Ключевые возможности
- 🔐 Защищённая JWT-авторизация (httpOnly cookies)
- 📦 CRUD товаров с загрузкой фото и учётом остатков
- 🔄 Автоматическая синхронизация остатков WB ↔ Sklad ↔ Ozon (каждые 60 сек)
- 📥 Обработка заказов с маркетплейсов (авто-списание)
- 🧮 Ручная корректировка остатков (delta ±N)
- 🕒 Полный аудит всех действий
- 📊 Импорт товаров из Excel (WB-формат)

---

## Стек технологий

| Слой | Технологии | Версии |
|------|-----------|--------|
| **Фронтенд** | React, Vite, TailwindCSS, React Router, Axios, Lucide React, date-fns | React 19, Vite 7, Tailwind 4 |
| **Бэкенд** | NestJS, Prisma ORM, PostgreSQL, JWT, Multer, Helmet, bcrypt | NestJS 11, Prisma 5, PG 15 |
| **Инфраструктура** | Docker Compose (3 сервиса), Nginx | Docker Compose 3.9 |

---

## Монорепо-структура

Проект — это **npm workspaces монорепо** с двумя приложениями:

```
Skladoptima/                    ← корень монорепо
├── package.json                ← workspaces: ["apps/*"], скрипты: dev, build
├── docker-compose.yml          ← 3 контейнера: postgres, api, web
├── .env.example                ← шаблон переменных окружения
│
├── apps/
│   ├── api/                    ← NestJS бэкенд (порт 3000)
│   │   ├── prisma/
│   │   │   ├── schema.prisma   ← 5 моделей (см. docs/DATABASE.md)
│   │   │   ├── seed.ts         ← admin@sklad.ru / admin777
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   ├── main.ts         ← bootstrap: CORS, Helmet, ValidationPipe, prefix /api
│   │   │   ├── app.module.ts   ← корневой модуль, глобальный JwtAuthGuard
│   │   │   ├── auth/           ← login, logout, me, JWT strategy
│   │   │   ├── product/        ← CRUD + stock-adjust + import
│   │   │   ├── audit/          ← журнал действий
│   │   │   ├── sync/           ← WB/Ozon sync (~700 строк, ГЛАВНЫЙ модуль)
│   │   │   ├── settings/       ← CRUD API-ключей маркетплейсов
│   │   │   ├── health/         ← GET /api/health
│   │   │   ├── user/           ← findByEmail
│   │   │   └── prisma/         ← PrismaService (global module)
│   │   ├── uploads/            ← загруженные фото товаров
│   │   └── Dockerfile          ← node:20-slim multi-stage
│   │
│   └── web/                    ← React фронтенд (порт 5173 dev / 80 prod)
│       ├── src/
│       │   ├── App.tsx         ← роутинг + PrivateRoute
│       │   ├── main.tsx        ← BrowserRouter + AuthProvider
│       │   ├── context/
│       │   │   └── AuthContext.tsx  ← axios defaults, auth state
│       │   ├── layouts/
│       │   │   └── MainLayout.tsx  ← sidebar: Остатки, История, Заказы, Настройки
│       │   └── pages/
│       │       ├── Login.tsx       ← форма входа
│       │       ├── Products.tsx    ← таблица товаров (~570 строк, ГЛАВНАЯ страница)
│       │       ├── History.tsx     ← аудит-лог
│       │       ├── Orders.tsx      ← заказы маркетплейсов
│       │       └── Settings.tsx    ← API-ключи WB/Ozon + тест подключения
│       ├── vite.config.ts      ← proxy /api → :3000, /uploads → :3000
│       ├── nginx.conf          ← для Docker: proxy /api, static /
│       └── Dockerfile          ← multi-stage → nginx
│
└── docs/                       ← ← ВЫ ЗДЕСЬ
    ├── ARCHITECTURE.md         ← этот файл
    ├── DATABASE.md             ← схема БД
    ├── API.md                  ← все endpoints
    ├── SYNC.md                 ← логика синхронизации
    ├── FRONTEND.md             ← React-приложение
    └── DEPLOYMENT.md           ← Docker, .env, деплой
```

---

## Поток данных

```
Пользователь (браузер)
    │
    ▼
React App (Vite / Nginx)
    │  axios + httpOnly cookie
    ▼
NestJS API (порт 3000, prefix /api)
    │  Prisma ORM
    ▼
PostgreSQL (Docker)
    │
    ▼  (фоновый процесс каждые 60 сек)
SyncService
    ├──→ WB Marketplace API  (pull остатков, push остатков, pull заказов)
    └──→ Ozon Seller API     (pull остатков, push остатков, pull заказов)
```

---

## Модули NestJS (app.module.ts)

| Модуль | Файлы | Роль |
|--------|-------|------|
| `PrismaModule` | `prisma/prisma.module.ts`, `prisma.service.ts` | Глобальный Prisma Client |
| `AuthModule` | `auth/*.ts` (7 файлов) | JWT стратегия, login/logout, @Public() декоратор |
| `UserModule` | `user/user.module.ts`, `user.service.ts` | `findByEmail()` |
| `ProductModule` | `product/*.ts` (6 файлов) | CRUD, stock-adjust, import, Multer upload |
| `AuditModule` | `audit/*.ts` (3 файла) | Запись и чтение audit log |
| `SettingsModule` | `settings/*.ts` (4 файла) | CRUD MarketplaceSettings |
| `SyncModule` | `sync/*.ts` (3 файла) | **Ядро**: WB/Ozon sync, заказы, metadata |
| `HealthModule` | `health/*.ts` (2 файла) | `GET /api/health` для Docker healthcheck |
| `ServeStaticModule` | — (NestJS built-in) | Раздача `/uploads` |

**Глобальный guard**: `JwtAuthGuard` (через `APP_GUARD`). Все endpoints защищены JWT. Открытые помечены `@Public()`.

---

## Связанные документы

| Документ | Содержит |
|----------|----------|
| [DATABASE.md](./DATABASE.md) | Все модели Prisma, поля, типы данных, enum'ы, связи |
| [API.md](./API.md) | Все REST endpoints с request/response, DTO, guards |
| [SYNC.md](./SYNC.md) | Алгоритм синхронизации, ping-pong prevention, обработка заказов |
| [FRONTEND.md](./FRONTEND.md) | React компоненты, роутинг, state, взаимодействие с API |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Docker Compose, .env переменные, деплой на VPS, healthchecks |

---

## Быстрый старт локально

```bash
# 1. Поднять БД
docker-compose up -d postgres

# 2. Установить зависимости и создать таблицы
cd apps/api && npm install && npx prisma migrate dev --name init
cd ../web && npm install
cd ../..

# 3. Запустить всё
npm run dev
# API: http://localhost:3000
# Web: http://localhost:5173

# Логин: admin@sklad.ru / admin777
```
