# TASK_ONBOARDING_1 — Data Model, Bootstrap Scopes и Versioning

> Модуль: `04-onboarding`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - утверждена системная аналитика `04-onboarding`
- Что нужно сделать:
  - завести `onboarding_states` и `onboarding_step_progress`;
  - поддержать два scope: `user_bootstrap` и `tenant_activation`;
  - предусмотреть `status`, `last_step_key`, `version` и историю шагов;
  - зафиксировать модель перехода от user-bootstrap к tenant-scoped state без потери прогресса;
  - заложить versioning каталога шагов для будущих изменений onboarding.
- Критерий закрытия:
  - модель данных соответствует `04-onboarding`;
  - bootstrap до создания tenant не теряется;
  - состояние шагов устойчиво к изменениям продуктового каталога.

**Что сделано**

### Схема БД (`prisma/schema.prisma`)

Добавлены три новых enum:
- `OnboardingScope`: `USER_BOOTSTRAP` | `TENANT_ACTIVATION`
- `OnboardingStatus`: `IN_PROGRESS` | `COMPLETED` | `CLOSED`
- `OnboardingStepStatus`: `PENDING` | `VIEWED` | `DONE` | `SKIPPED`

Добавлены две модели:

**`OnboardingState`** — основная запись онбординга:
- `scope` — тип онбординга (user_bootstrap или tenant_activation)
- `status` — текущее состояние (in_progress / completed / closed)
- `catalogVersion` — версия каталога шагов (`"v1"` по умолчанию), позволяет менять шаги без потери прогресса старых пользователей
- `lastStepKey` — последний активный шаг (для навигации)
- `completedAt`, `closedAt` — временные метки
- `userId` (nullable) — заполняется для USER_BOOTSTRAP
- `tenantId` (nullable) — заполняется для TENANT_ACTIVATION
- Уникальные индексы: `(userId, scope)` и `(tenantId, scope)` — PostgreSQL допускает несколько NULL-строк, поэтому USER_BOOTSTRAP-записи разных пользователей не конфликтуют при tenantId=NULL

**`OnboardingStepProgress`** — прогресс по каждому шагу:
- `stepKey` — ключ шага из каталога
- `status` — PENDING / VIEWED / DONE / SKIPPED
- `viewedAt`, `completedAt`, `skippedAt` — временные метки событий
- `metadata` (JSON) — опциональные данные шага
- Уникальный индекс: `(onboardingStateId, stepKey)` — один ряд на шаг

Добавлены relations:
- `User.onboardingStates OnboardingState[]`
- `Tenant.onboardingStates OnboardingState[]`

### Миграция

`prisma/migrations/20260426040000_onboarding_data_model/migration.sql` — создаёт enum-типы, таблицы, уникальные и обычные индексы, foreign key constraints.

### Каталог шагов (`step-catalog.ts`)

Статическая конфигурация шагов по версиям. Версия `v1`:

| Scope | Key | Обязателен |
|-------|-----|-----------|
| USER_BOOTSTRAP | `welcome` | нет |
| USER_BOOTSTRAP | `setup_company` | нет (рекомендуемый) |
| TENANT_ACTIVATION | `connect_marketplace` | нет |
| TENANT_ACTIVATION | `add_products` | нет |
| TENANT_ACTIVATION | `invite_team` | нет |
| TENANT_ACTIVATION | `check_stocks` | нет |

Хелпер `getStepsForScope(scope, version?)` возвращает шаги для нужного scope и версии. При неизвестной версии падает back на `CURRENT_CATALOG_VERSION`.

### Модуль (`onboarding.module.ts`)

Базовая структура NestJS-модуля с `OnboardingService` и `OnboardingController`. Модуль подключён в `app.module.ts` и экспортирует `OnboardingService` для использования в `TenantModule` (TASK_ONBOARDING_3).

### `OnboardingService` — init-хелперы

- `initUserBootstrap(userId)` — идемпотентно создаёт USER_BOOTSTRAP state + шаги каталога v1
- `initTenantActivation(tenantId)` — идемпотентно создаёт TENANT_ACTIVATION state + шаги каталога v1
- `getUserBootstrapState(userId)` / `getTenantActivationState(tenantId)` — чтение состояния с шагами

Оба init-метода атомарны (`$transaction`) и идемпотентны (проверяют `findUnique` перед созданием).

### Улучшения (ревью T4-01)

**Race condition fix в init-методах:**

`initUserBootstrap` и `initTenantActivation` использовали паттерн `findUnique → create`, который не атомарен: два параллельных вызова могли оба пройти проверку и оба попасть в транзакцию, при этом второй `create` падал с `P2002` (unique constraint). Добавлен try/catch вокруг `$transaction`:
- при поимке `PrismaClientKnownRequestError` с кодом `P2002` — возвращаем существующую запись через `findUniqueOrThrow`
- все остальные ошибки пробрасываются выше

**Обогащение `StepDef` в каталоге:**

Добавлены два поля в интерфейс `StepDef`:
- `ctaLink: string | null` — ссылка для CTA-кнопки виджета (null для информационных шагов)
- `autoCompleteEvent: string | null` — имя domain event, при котором шаг автоматически помечается DONE (null = только user_action)

Каталог шагов v1 заполнен значениями согласно §11.3 и §8 системной аналитики:
| Key | ctaLink | autoCompleteEvent |
|-----|---------|------------------|
| `welcome` | null | null |
| `setup_company` | `/onboarding/create-company` | `tenant_created` |
| `connect_marketplace` | `/app/settings/marketplace` | `marketplace_account_connected` |
| `add_products` | `/app/catalog/import` | `first_product_created` |
| `invite_team` | `/app/settings/team` | `first_invite_sent` |
| `check_stocks` | `/app/warehouse` | null |

### TypeScript

`tsc --noEmit` — 0 ошибок.

---

**Дальнейшие шаги**: TASK_ONBOARDING_2 — State API (GET /onboarding/state, PATCH /steps/:stepKey, POST /close, POST /complete).
