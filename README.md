# SkladOptima 📦

**SkladOptima** — это multi-tenant SaaS (операционный веб-сервис) для селлеров на маркетплейсах (Wildberries, Ozon).

Продукт решает 4 ключевые задачи:
1. Учет товаров и складских остатков.
2. Синхронизация с маркетплейсами.
3. Юнит-экономика и финансовый учет.
4. Аудит и контроль действий пользователей.

Это не просто складской учет, а полноценный B2B сервис, где важны изоляция данных (tenant isolation), роли и доступы, история изменений и надежная подписочная модель.

---

## 🏗 Ключевая Доменная Модель (Core Domain Model)

В основе системы лежит строгое **разделение Физических Пользователей и Компаний**.

* **`Tenant`** — аккаунт компании в SaaS (клиент, оформивший подписку).
* **`User`** — физический пользователь системы (логин/email/пароль).
* **`Membership`** — связь пользователя с Tenant. Определяет его **роль** (OWNER, MANAGER, STAFF, SUPPORT_ADMIN). Пользователь может гипотетически состоять в нескольких Tenant-ах.
* **`MarketplaceAccount`** — подключенный кабинет WB/Ozon (у Tenant может быть несколько кабинетов). Подвязывается через API ключи.

*Важно: Роль пользователя (Membership Role) и Коммерческий доступ компании (Access State) — это разные вещи.*
Коммерческий доступ (Access State) принадлежит **Tenant** и может быть: `EARLY_ACCESS`, `TRIAL_ACTIVE`, `ACTIVE_PAID`, `SUSPENDED` и т.д.

---

## ⚙️ Высокоуровневая Архитектура (High-Level Architecture)

Проект построен как **Modular Monolith** в монорепозитории (NPM Workspaces).

### Архитектурные Слои
1. **Frontend (`apps/web`):** Реализован на React 19 + Vite + TailwindCSS v4. SPA с модульной (FSD-подобной) структурой: pages, features, entities, shared.
2. **Backend API (`apps/api`):** Реализован на NestJS. Строго разделен на модули (Auth, Tenants, Memberships, Catalog, Inventory, Finance, Billing). Отвечает за обработку HTTP-запросов и обслуживание клиентского UI. 
3. **Background Worker (`apps/worker`):** Отдельное NestJS-приложение. Отвечает за ресурсоемкие фоновые задачи: синхронизацию с WB/Ozon по крону, пакетный импорт/экспорт (batch jobs), рассылку email-ов и пересчет очередей. Защищает основное API от перегрузок.
4. **Database (PostgreSQL via Prisma):** Единая реляционная система управления базами данных. Доступ к данным строго изолирован по `tenantId` (Multi-Tenancy).
5. **Cache / Queues (Redis):** Используется для управления очередями Worker'a, кеширования, Rate Limiting и идемпотентности.
6. **S3 File Storage:** Физическое хранение всех изображений товаров, экспортов и превью. В PostgreSQL сохраняются только ссылки и метаданные загруженных файлов.

---

## 📂 Структура Репозитория (Repo Structure)

Проект использует Monorepo:

```text
skladoptima/
├── apps/
│   ├── web/          # Frontend-интерфейс (React)
│   ├── api/          # Главное Backend-API (NestJS)
│   └── worker/       # Фоновые процессы и парсинг (NestJS) (в процессе выделения)
├── packages/         # Shared логика (в процессе выделения)
│   ├── types/
│   ├── ui/
│   └── validation/
├── docs/             # Инженерная и продуктовая документация (MUST READ!)
│   ├── product/
│   ├── architecture/
│   ├── engineering/
│   └── database/
├── docker-compose.yml# Инфраструктура (PostgreSQL, Redis)
└── package.json      # Workspace root
```

💡 **Ключевой принцип (Multi-Tenancy):** Вся авторизация — tenant-aware. Доступ к любым модулям (Products, AuditLogs, Finance) всегда проверяется через `tenantId`, привязанный к `Membership` текущего юзера.

---

## 👩‍💻 Запуск для Разработки (Local Development)

### 1. Инфраструктура
Для запуска потребуется запущенный [Docker Desktop](https://www.docker.com/). Поднимите PostgreSQL и Redis (если используется настроенный docker-compose):
```bash
docker-compose up -d
```

### 2. База данных
Установите зависимости и накатите таблицы в базу через Prisma:
```bash
cd apps/api
npm install
npx prisma migrate dev --name init
```

### 3. Запуск монорепы
Вернитесь в корень и запустите локальный сервер (`concurrently` запустит Web и API):
```bash
cd ../..
npm install
npm run dev
```

Откройте в браузере: **[http://localhost:5173](http://localhost:5173)**

---

## 📚 Документация (Docs Map)
Перед началом работы над любым модулем, обязательно изучите основные архитектурные решения:

1. **Архитектура и Модели:**
   - [Domain Model & Bounded Contexts](./docs/architecture/domain-model.md)
   - [Access & Billing Model](./docs/architecture/access-model.md)
2. **База данных:**
   - [Проектирование БД](./docs/DATABASE_DESIGN.md) (старая версия, в процессе адаптации)
3. **Product & User Flows:**
   - [Пользовательский путь](./docs/USER_FLOW.md)
