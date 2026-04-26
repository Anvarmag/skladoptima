# TASK_TENANT_1 — Tenant Data Model, AccessState и миграции

> Модуль: `02-tenant`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `02-tenant`
- Что нужно сделать:
  - завести таблицы `tenants`, `tenant_settings`, `tenant_access_state_events`, `tenant_closure_jobs`;
  - зафиксировать состояния `tenant.status`, `tenant.access_state`, связи с membership и owner;
  - предусмотреть поля под `closed_at`, retention lifecycle, access-state history и runtime warnings;
  - описать миграционный порядок без поломки текущего auth/bootstrap контекста.
- Критерий закрытия:
  - схема БД соответствует `02-tenant`;
  - AccessState и lifecycle состояния описаны и реализуемы без серых зон;
  - миграции воспроизводимы.

---

**Что сделано (2026-04-26)**

### 1. schema.prisma — новые enum-типы

Добавлены три новых Prisma enum:

- `TenantStatus` (`ACTIVE`, `CLOSED`) — lifecycle статус тенанта, отдельный от `AccessState`
- `TenantActorType` (`SYSTEM`, `BILLING`, `SUPPORT`, `USER`) — источник изменения `AccessState`
- `TenantClosureJobStatus` (`PENDING`, `PROCESSING`, `ARCHIVED`, `DELETED`, `FAILED`) — статус задачи на retention

`AccessState` расширен значением `GRACE_PERIOD` (между `ACTIVE_PAID` и `SUSPENDED`), которое требовалось аналитикой но отсутствовало в схеме.

### 2. schema.prisma — модель `Tenant` расширена

Добавлены поля:
- `inn String? @unique` — ИНН компании (nullable для обратной совместимости с существующими тенантами)
- `status TenantStatus @default(ACTIVE)` — lifecycle статус тенанта
- `primaryOwnerUserId String?` — FK → User с именованным relation `TenantPrimaryOwner`; `onDelete: SetNull`
- `closedAt DateTime?` — фиксируется при переходе тенанта в `CLOSED`

Удалены `taxSystem` и `vatThresholdExceeded` — перенесены в `TenantSettings`.

Добавлены relation-поля: `settings`, `accessStateEvents`, `closureJob`.

На `User` добавлено обратное отношение `ownedTenants Tenant[] @relation("TenantPrimaryOwner")`.

### 3. schema.prisma — новые модели

**`TenantSettings`** (`tenantId` PK, FK → Tenant):
- `taxSystem TaxSystem @default(USN_6)` — перенесён из Tenant
- `vatThresholdExceeded Boolean @default(false)` — перенесён из Tenant
- `country`, `currency`, `timezone`, `legalName` — nullable, заполняются при onboarding
- `createdAt`, `updatedAt`

**`TenantAccessStateEvent`** — append-only audit trail каждого AccessState-перехода:
- `fromState AccessState?` — nullable (для первого перехода нет предыдущего состояния)
- `toState AccessState` — обязателен
- `reasonCode String` — code-style строка (e.g. `TRIAL_PERIOD_ENDED`)
- `reasonDetails Json?` — опциональный контекст
- `actorType TenantActorType` — кто инициировал
- `actorId String?` — userId или serviceId актора
- индекс по `(tenantId, createdAt)`

**`TenantClosureJob`** — задача на retention/archival после закрытия:
- `tenantId @unique` — один активный job на тенант
- `status TenantClosureJobStatus @default(PENDING)`
- `scheduledFor DateTime` — когда выполнить
- `processedAt DateTime?`, `failureReason String?`

### 4. Миграция `20260426000000_tenant_domain_model`

Миграция безопасна для существующих данных:
1. Создаёт новые enum-типы (`TenantStatus`, `TenantActorType`, `TenantClosureJobStatus`)
2. Добавляет `GRACE_PERIOD` в `AccessState`
3. Добавляет новые колонки в `Tenant` (nullable — не ломает существующие строки)
4. Создаёт `TenantSettings` и **data-migrates** все существующие тенанты: `INSERT INTO "TenantSettings" SELECT id, taxSystem, vatThresholdExceeded FROM "Tenant"`
5. Дропает `taxSystem`/`vatThresholdExceeded` из `Tenant` (данные уже в `TenantSettings`)
6. Создаёт `TenantAccessStateEvent` с составным индексом
7. Создаёт `TenantClosureJob` с unique constraint на `tenantId`

### 5. Сервисы обновлены под новую схему

**`finance.service.ts`**:
- `findUnique` расширен `include: { settings: true }`
- Все обращения `store.taxSystem` → `store.settings?.taxSystem` (3 места)

**`settings.service.ts`**:
- `getStore` теперь включает `settings: true`
- `updateStore` разделён: `name` обновляется через `tenant.update`, а `taxSystem`/`vatThresholdExceeded` — через `tenantSettings.upsert` (создаёт запись если её нет)

**`prisma/seed.ts`**:
- Tenant.create теперь использует nested write `settings: { create: { taxSystem: TaxSystem.USN_6 } }`

### 6. Верификация

- `prisma validate` → схема валидна
- `prisma generate` → Prisma Client сгенерирован без ошибок
- `tsc --noEmit` → 0 ошибок TypeScript
