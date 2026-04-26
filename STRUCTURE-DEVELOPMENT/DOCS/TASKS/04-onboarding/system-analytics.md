# Онбординг — Системная аналитика

> Статус: [ ] В работе
> Последнее обновление: 2026-04-26
> Связанный раздел: `04-onboarding`

---

## 1. Назначение модуля

Онбординг — guided flow для нового пользователя от первого входа до **первой полезной ценности**: подключённого маркетплейса, загруженного каталога и понятного следующего шага.

**Он не блокирует работу.** Онбординг — это подсказчик, который можно закрыть и вернуться позже. Его задача — сократить time-to-value и снизить отток после первой авторизации (BG-01, BG-02, BG-03).

### Текущее состояние (as-is)

**Выполнено (T4-01, 2026-04-26):**
- Схема БД: `OnboardingState`, `OnboardingStepProgress`, enums `OnboardingScope` / `OnboardingStatus` / `OnboardingStepStatus`.
- Миграция `20260426040000_onboarding_data_model`.
- Каталог шагов `step-catalog.ts` v1: USER_BOOTSTRAP (`welcome` + `setup_company`) + TENANT_ACTIVATION (4 шага); поля `ctaLink` и `autoCompleteEvent` в `StepDef`.
- `OnboardingService`: идемпотентные `initUserBootstrap` / `initTenantActivation` с защитой от race condition (`P2002` → re-fetch), методы чтения.
- `OnboardingModule` подключён в `app.module.ts`, экспортирован.

**Выполнено (T4-02, 2026-04-26):**
- `GET /onboarding/state`, `POST /start`, `PATCH /steps/:stepKey`, `POST /close`, `POST /reopen`, `POST /complete`
- Scope resolution из `activeTenantId` запроса
- Step state machine с валидацией переходов и idempotency
- `formatResponse` с `progress`, `nextRecommendedStep`, `isCtaBlocked` (заглушка до T4-05)
- Structured logging для всех state/step событий

**Выполнено (T4-03, 2026-04-26):**
- `AuthService.verifyEmail()` → `initUserBootstrap(userId)` (fire-and-forget, логирует ошибку)
- `TenantService.createTenant()` → `handleTenantCreatedOnboarding(userId, tenantId)` (fire-and-forget)
  - `initTenantActivation(tenantId)` — создаёт TENANT_ACTIVATION state
  - `markStepDone('USER_BOOTSTRAP', userId, 'setup_company', 'domain_event')` — auto-complete шага
- USER_BOOTSTRAP автозавершается в `COMPLETED` при `setup_company → DONE`
- История шагов сохраняется при handoff, записи не удаляются
- Post-login routing: `getMe()` возвращает `/onboarding` без tenant, `/app` после создания компании
- Idempotency: P2002 race condition защита в обоих init-методах

**Выполнено (T4-04, 2026-04-26):**
- `TeamService.createInvitation()` → `markStepDone('TENANT_ACTIVATION', tenantId, 'invite_team', 'domain_event')`
- `SettingsService.updateSettings()` → `markStepDone('TENANT_ACTIVATION', tenantId, 'connect_marketplace', 'domain_event')` (флаг `didUpdate`, fire-and-forget)
- `ProductService.create()` → `markStepDone('TENANT_ACTIVATION', tenantId, 'add_products', 'domain_event')` (оба пути: новый + restore)
- `OnboardingModule` добавлен в импорты `TeamModule`, `SettingsModule`, `ProductModule`
- Все вызовы fire-and-forget с логированием ошибок через `logger.warn`

**Выполнено (T4-05, 2026-04-26):**
- `TenantAccessContext` тип + `getTenantAccessContext()` — параллельный fetch accessState + role
- `computeBlockReason(ctx?)` — приоритет ROLE_INSUFFICIENT > TRIAL_EXPIRED > TENANT_SUSPENDED > TENANT_CLOSED
- `assertTenantWriteAllowed(ctx, operation)` — 403 для STAFF (всегда), WRITE_BLOCKED states (всегда), MANAGER (кроме step_view)
- `formatResponse(state, ctx?)` — убраны заглушки, `isCtaBlocked`/`isBlocked`/`blockReason` вычисляются из ctx
- `getState()` / `startState()` — STAFF получает `{ state: null }`, остальные получают state с контекстом
- Write-методы (`updateStep`, `closeState`, `reopenState`, `completeState`) — guard при activeTenantId

**Выполнено (T4-07, 2026-04-26):**
- `onboarding.service.spec.ts` — 75 тестов, 100% зелёных; покрыты: init (idempotency + P2002), все state machine переходы, domain events, handoff USER_BOOTSTRAP→TENANT_ACTIVATION, access control (STAFF/MANAGER/OWNER/ADMIN), tenant access-state guards (TRIAL_EXPIRED/SUSPENDED/CLOSED), formatResponse, observability (все 8 JSON-событий)
- `checkStuckSteps(staleDaysThreshold = 7)` — метод в `OnboardingService`: находит IN_PROGRESS состояния не обновлявшиеся дольше порога, эмитит `onboarding_step_stale` на каждый застрявший шаг; предназначен для daily cron

---

## 2. Два scope и их смысл

Онбординг делится на два независимых состояния, которые отражают разные фазы жизни пользователя в продукте.

### USER_BOOTSTRAP
- **Когда**: сразу после подтверждения email, до создания первой компании.
- **Кому принадлежит**: пользователю (`userId`), независимо от tenant.
- **Задача**: провести пользователя к созданию компании.
- **Шаги (v1)**:
  - `welcome` — приветствие, первый показ продукта
  - `setup_company` — создание компании (рекомендуемый, не обязательный)
- **Завершается**: когда компания создана → шаг `setup_company` автоматически помечается `DONE`, state → `COMPLETED`.

### TENANT_ACTIVATION
- **Когда**: после создания первого tenant.
- **Кому принадлежит**: tenant (`tenantId`), виден всем OWNER/ADMIN этого tenant.
- **Задача**: привести команду к первой рабочей настройке — подключить маркетплейс, загрузить каталог, пригласить коллег.
- **Шаги (v1)**:
  - `connect_marketplace` — подключить Wildberries или Ozon
  - `add_products` — загрузить каталог товаров
  - `invite_team` — пригласить команду
  - `check_stocks` — проверить остатки
- **Завершается**: пользователь нажимает "Завершить" или все шаги выполнены / пропущены.

### Принцип независимости
USER_BOOTSTRAP и TENANT_ACTIVATION — **разные записи в БД**. Прогресс USER_BOOTSTRAP не удаляется при создании tenant. При handoff оба state существуют одновременно; фронтенд показывает актуальный для текущего контекста.

---

## 3. Модель данных

### 3.1 OnboardingState

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `scope` | `OnboardingScope` | `USER_BOOTSTRAP` или `TENANT_ACTIVATION` |
| `status` | `OnboardingStatus` | `IN_PROGRESS` / `COMPLETED` / `CLOSED` |
| `catalogVersion` | String | Версия каталога на момент создания state (default `"v1"`) |
| `lastStepKey` | String? | Последний просмотренный шаг — для resume |
| `completedAt` | DateTime? | Время завершения |
| `closedAt` | DateTime? | Время, когда пользователь закрыл панель |
| `userId` | String? | FK → User (заполнен только для USER_BOOTSTRAP) |
| `tenantId` | String? | FK → Tenant (заполнен только для TENANT_ACTIVATION) |

**Ограничения уникальности:**
- `UNIQUE(userId, scope)` — один USER_BOOTSTRAP на пользователя
- `UNIQUE(tenantId, scope)` — один TENANT_ACTIVATION на tenant
- PostgreSQL трактует `NULL` как различимые значения в unique index → строки с `tenantId=NULL` не конфликтуют между пользователями

### 3.2 OnboardingStepProgress

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `onboardingStateId` | UUID | FK → OnboardingState (CASCADE) |
| `stepKey` | String | Ключ шага из каталога |
| `status` | `OnboardingStepStatus` | `PENDING` / `VIEWED` / `DONE` / `SKIPPED` |
| `viewedAt` | DateTime? | Первый просмотр шага |
| `completedAt` | DateTime? | Выполнено |
| `skippedAt` | DateTime? | Пропущено |
| `metadata` | JSON? | Опциональные данные (например, id созданного объекта) |

**Ограничение:** `UNIQUE(onboardingStateId, stepKey)` — один ряд на шаг.

### 3.3 Versioning каталога

`catalogVersion` фиксируется в `OnboardingState` при создании. Если в v2 изменится состав шагов — пользователи на v1 продолжают работать по старому каталогу, новые получают v2. `getStepsForScope(scope, version?)` в `step-catalog.ts` реализует fallback на `CURRENT_CATALOG_VERSION`.

---

## 4. Каталог шагов v1

### USER_BOOTSTRAP

| # | Key | Title | Обязателен | Source | Auto-complete |
|---|-----|-------|-----------|--------|---------------|
| 1 | `welcome` | Добро пожаловать | нет | user_action | нет |
| 2 | `setup_company` | Создайте компанию | нет (рекомендуемый) | domain_event | да — при `tenant_created` |

### TENANT_ACTIVATION

| # | Key | Title | Обязателен | Source | Auto-complete trigger |
|---|-----|-------|-----------|--------|-----------------------|
| 1 | `connect_marketplace` | Подключите маркетплейс | нет | domain_event | `marketplace_account_connected` |
| 2 | `add_products` | Загрузите каталог | нет | domain_event | `first_product_created` |
| 3 | `invite_team` | Пригласите команду | нет | domain_event | `first_invite_sent` |
| 4 | `check_stocks` | Проверьте остатки | нет | user_action | нет |

> `check_stocks` завершается явным действием пользователя: переход по CTA фиксирует `viewed`, затем пользователь нажимает «Готово» в карточке шага — фронтенд вызывает `PATCH /steps/check_stocks { status: "done" }`. Domain event для этого шага не предусмотрен.

**`source`** — откуда пришло обновление шага:
- `user_action` — явное действие пользователя через API
- `domain_event` — автоматическое завершение по событию из другого модуля
- `migration` — системный перенос при handoff

---

## 5. State Machine

### OnboardingStatus

```
              ┌─────────────────────────────┐
              │                             ↓
   [start] → IN_PROGRESS → CLOSED → IN_PROGRESS (reopen)
                  │
                  ↓
              COMPLETED  (финальный, необратимый)
```

- `IN_PROGRESS` → `CLOSED`: пользователь закрыл панель (кнопка "Закрыть")
- `CLOSED` → `IN_PROGRESS`: пользователь открыл снова (кнопка "Продолжить")
- `IN_PROGRESS` → `COMPLETED`: все required шаги выполнены или пользователь нажал "Завершить"
- `COMPLETED` → (нет переходов): финальное состояние

### OnboardingStepStatus

```
PENDING → VIEWED  (шаг отображён на фронтенде)
PENDING → DONE    (выполнено: user_action или domain_event)
PENDING → SKIPPED (явный пропуск пользователем)
VIEWED  → DONE
VIEWED  → SKIPPED
SKIPPED → PENDING (после reopen state — шаг возвращается в pending)
DONE    → (необратимо)
```

**Reopen semantics**: при `POST /onboarding/reopen` шаги со статусом `SKIPPED` сбрасываются в `PENDING`, чтобы пользователь мог выполнить их повторно. Шаги `DONE` не меняются.

---

## 6. Bootstrap-to-Tenant Handoff

Самый важный момент жизненного цикла — переход от `USER_BOOTSTRAP` к `TENANT_ACTIVATION`.

### Порядок действий при создании tenant

1. Пользователь вызывает `POST /tenants` (TASK_TENANT_2 / `TenantService.createTenant`)
2. В той же транзакции (или post-commit hook):
   - шаг `setup_company` в USER_BOOTSTRAP → `DONE` (source: `domain_event`)
   - если все required шаги USER_BOOTSTRAP выполнены → state → `COMPLETED`
   - `OnboardingService.initTenantActivation(tenantId)` → создаёт TENANT_ACTIVATION state
3. `GET /auth/me` возвращает `nextRoute: '/app'` (tenant теперь есть)
4. Фронтенд переключается с USER_BOOTSTRAP wizard на TENANT_ACTIVATION wizard

### Гарантии

- Handoff идемпотентен: повторный вызов `initTenantActivation` возвращает existing state
- USER_BOOTSTRAP state сохраняется в БД — история не удаляется
- Если пользователь создаёт второй tenant — для него создаётся свой TENANT_ACTIVATION state

### Удаление tenant

TENANT_ACTIVATION state каскадно удаляется вместе с tenant (`onDelete: Cascade` на `tenantId` FK в схеме). Шаги удаляются каскадно от state. В production удаление tenant запрещено — доступна только смена AccessState → `CLOSED`, поэтому каскад используется исключительно для dev/seed операций.

### Инициализация USER_BOOTSTRAP

`initUserBootstrap(userId)` вызывается из `AuthService.verifyEmail()` сразу после подтверждения email — в тот момент, когда пользователь становится `ACTIVE` и ещё не имеет tenant.

---

## 7. API контракт

### 7.1 Scope Resolution

Scope определяется автоматически из контекста запроса:
- Есть `activeTenantId` в request → TENANT_ACTIVATION
- Нет `activeTenantId` → USER_BOOTSTRAP

Фронтенд никогда не передаёт scope явно — это серверная логика.

### 7.2 Endpoints

```
GET  /onboarding/state
```
Возвращает текущий state для актуального scope + шаги + `nextRecommendedStep` + `isBlocked` + `blockReason`.

```json
{
  "scope": "TENANT_ACTIVATION",
  "status": "IN_PROGRESS",
  "catalogVersion": "v1",
  "progress": { "total": 4, "done": 1, "skipped": 0 },
  "nextRecommendedStep": "add_products",
  "isBlocked": false,
  "steps": [
    {
      "key": "connect_marketplace",
      "title": "Подключите маркетплейс",
      "status": "DONE",
      "required": false,
      "completedAt": "2026-04-26T10:00:00Z"
    },
    {
      "key": "add_products",
      "title": "Загрузите каталог",
      "status": "PENDING",
      "required": false
    }
  ]
}
```

> Если state для текущего scope не существует — возвращает `200 OK` с телом `{ "state": null }`. Фронтенд скрывает виджет и при необходимости вызывает `POST /onboarding/start` для инициализации.

```
POST /onboarding/start
```
Страховочный endpoint. В штатном режиме state создаётся автоматически: USER_BOOTSTRAP — в `AuthService.verifyEmail()`, TENANT_ACTIVATION — в `TenantService.createTenant()`. `POST /start` предназначен для восстановления при сбое автоматической инициализации (seed, admin-операции, ошибка в транзакции). Если state уже существует — возвращает его без изменений.

```
PATCH /onboarding/steps/:stepKey
Body: { "status": "done" | "skipped" | "viewed" }
```
Идемпотентное обновление шага. Повторный вызов с тем же статусом — no-op. Переход `done → skipped` недопустим. Записывает timestamp события.

```
POST /onboarding/close
```
`status` → `CLOSED`, записывает `closedAt`. Можно вызывать сколько угодно раз (idempotent).

```
POST /onboarding/reopen
```
`CLOSED` → `IN_PROGRESS`, сбрасывает `SKIPPED` шаги → `PENDING`. Если state `COMPLETED` — возвращает ошибку `ONBOARDING_ALREADY_COMPLETED`.

```
POST /onboarding/complete
```
`IN_PROGRESS` → `COMPLETED`, записывает `completedAt`. Доступно даже если не все шаги выполнены (пользователь может завершить вручную).

### 7.3 Рекомендуемый следующий шаг

`nextRecommendedStep` — первый шаг со статусом `PENDING` или `VIEWED` в порядке `order` из каталога. Если таких нет — `null`.

### 7.4 Error Codes

| Code | HTTP | Когда |
|------|------|-------|
| `ONBOARDING_STATE_NOT_FOUND` | 404 | `GET /state`, `PATCH /steps/:stepKey` — state не инициализирован |
| `ONBOARDING_STEP_NOT_FOUND` | 404 | `PATCH /steps/:stepKey` — stepKey не существует в каталоге текущей версии |
| `ONBOARDING_INVALID_TRANSITION` | 400 | Недопустимый переход статуса (напр. `DONE → SKIPPED`, `DONE → PENDING`) |
| `ONBOARDING_ALREADY_COMPLETED` | 409 | `POST /reopen` — state уже `COMPLETED` |
| `ONBOARDING_WRONG_STATE` | 409 | `POST /complete` или `POST /close` при state `COMPLETED` |
| `ONBOARDING_FORBIDDEN` | 403 | Роль не позволяет операцию (MANAGER пытается поставить `DONE`/`SKIPPED`) |

### 7.5 Конкурентные обновления

`PATCH /steps/:stepKey` идемпотентен: повторный вызов с тем же статусом — no-op. Защита от race condition при параллельных вкладках реализуется через `upsert` с `where: { onboardingStateId_stepKey }` — PostgreSQL гарантирует атомарность на уровне строки. `SELECT FOR UPDATE` не требуется, так как переходы строго однонаправлены (`DONE` — терминальное состояние) и повторный `DONE` является no-op.

---

## 8. Domain Events и Auto-Complete

Когда пользователь совершает реальное действие в продукте, соответствующий шаг онбординга должен завершиться **автоматически** — без дополнительного клика.

### Таблица соответствий

| Событие в домене | Шаг | Scope |
|-----------------|-----|-------|
| Tenant создан (`TenantService.createTenant`) | `setup_company` → DONE | USER_BOOTSTRAP |
| Marketplace account подключён | `connect_marketplace` → DONE | TENANT_ACTIVATION |
| Первый товар создан | `add_products` → DONE | TENANT_ACTIVATION |
| Первый инвайт отправлен | `invite_team` → DONE | TENANT_ACTIVATION |

### Реализация (T4-04)

`OnboardingService` экспортирует метод `markStepDone(scope, scopeId, stepKey, source)`, который вызывается из соответствующих доменных сервисов. Метод идемпотентен — повторный вызов на `DONE` шаге — no-op.

---

## 9. Tenant Access-State Guards

Онбординг должен учитывать состояние тенанта. Нельзя предлагать действия, которые недоступны.

| AccessState | Поведение онбординга |
|-------------|---------------------|
| `TRIAL_ACTIVE`, `ACTIVE_PAID`, `GRACE_PERIOD` | Полный доступ, все CTA активны |
| `TRIAL_EXPIRED` | Read-only: прогресс виден, CTA заблокированы. `isBlocked: true, blockReason: 'TRIAL_EXPIRED'` |
| `SUSPENDED` | Read-only + баннер с призывом к оплате |
| `CLOSED` | Онбординг скрыт, только billing/support CTA |
| `EARLY_ACCESS` | Полный доступ |

В ответе `GET /onboarding/state` каждый шаг имеет поле `isCtaBlocked: boolean` — фронтенд не рисует интерактивную кнопку, если оно `true`.

### Приоритет блокировок

Если действует несколько ограничений одновременно (например, роль MANAGER + `TRIAL_EXPIRED`), backend возвращает наиболее специфичную причину через `blockReason`:

| blockReason | Источник |
|-------------|---------|
| `ROLE_INSUFFICIENT` | Роль пользователя не позволяет изменять шаги |
| `TRIAL_EXPIRED` | AccessState tenant'а |
| `TENANT_SUSPENDED` | AccessState tenant'а |
| `TENANT_CLOSED` | AccessState tenant'а |

Приоритет: `ROLE_INSUFFICIENT` > AccessState-причины. Фронтенд показывает пояснительный текст — не просто заблокированную кнопку.

---

## 10. Role-Aware Availability

| Роль | Видит онбординг | Может выполнять шаги | Может закрыть/завершить |
|------|----------------|---------------------|------------------------|
| OWNER | да | да | да |
| ADMIN | да | да | да |
| MANAGER | да | только `viewed` | нет |
| STAFF | нет | нет | нет |

MANAGER может просматривать онбординг (для ознакомления), но не может отмечать шаги как `DONE` или `SKIPPED` — это действия, влияющие на бизнес-настройку.

---

## 11. Frontend Contract

### 11.1 Откуда брать scope

Фронтенд при старте запрашивает `GET /auth/me`. Если `nextRoute === '/onboarding'` — нет tenant, показываем USER_BOOTSTRAP wizard. Если `nextRoute === '/app'` и tenant есть — показываем TENANT_ACTIVATION widget (sidebar или плавающий элемент).

### 11.2 Resume после перезагрузки

При каждом входе фронтенд запрашивает `GET /onboarding/state`. Backend является единственным источником истины. Local state не используется.

`lastStepKey` в ответе указывает, на каком шаге остановился пользователь — фронтенд открывает этот шаг автоматически.

### 11.3 Deep Links

Каждый шаг каталога имеет `ctaLink` — ссылка на страницу, где выполняется действие:

| Шаг | ctaLink |
|-----|---------|
| `setup_company` | `/onboarding/create-company` |
| `connect_marketplace` | `/app/settings/marketplace` |
| `add_products` | `/app/catalog/import` |
| `invite_team` | `/app/settings/team` |
| `check_stocks` | `/app/warehouse` |

При переходе по CTA фронтенд вызывает `PATCH /steps/:stepKey { status: "viewed" }` — чтобы зафиксировать просмотр.

### 11.4 Состояния виджета

| Состояние backend | Состояние виджета |
|------------------|-----------------|
| state не существует | Скрыт |
| `IN_PROGRESS`, есть шаги | Открыт с прогресс-баром |
| `CLOSED` | Свёрнут, кнопка "Продолжить" |
| `COMPLETED` | Показывает congratulations, затем скрывается |

### 11.5 Переключение между tenant'ами

Пользователь может управлять несколькими компаниями. При смене `activeTenantId` фронтенд заново запрашивает `GET /onboarding/state` — каждый tenant имеет независимый TENANT_ACTIVATION state:

- Новый tenant (только создан) → state `IN_PROGRESS`, онбординг показывается снова.
- Старый tenant (онбординг завершён) → state `COMPLETED`, виджет скрыт.
- USER_BOOTSTRAP при этом не меняется — он принадлежит пользователю, а не tenant.

Фронтенд не кэширует onboarding state между переключениями tenant'ов.

---

## 12. Observability

### Структурированные события (Logger.log JSON)

| Event | Когда |
|-------|-------|
| `onboarding_bootstrap_created` | initUserBootstrap создал новый state |
| `onboarding_activation_created` | initTenantActivation создал новый state |
| `onboarding_step_updated` | шаг обновлён (с source: user_action / domain_event) |
| `onboarding_state_closed` | пользователь закрыл онбординг |
| `onboarding_state_completed` | онбординг завершён |
| `onboarding_state_reopened` | пользователь вернулся |

### Funnel метрики (T4-07)

- **Activation rate**: доля пользователей, создавших tenant после USER_BOOTSTRAP
- **Step completion rate**: процент выполнения каждого шага TENANT_ACTIVATION
- **Drop-off шаг**: на каком шаге больше всего пропусков и закрытий
- **Time-to-complete**: среднее время от создания state до COMPLETED

### Алертинг

- Пользователь застрял на одном шаге > 7 дней → event `onboarding_step_stale`
- Доля `CLOSED` без `COMPLETED` > X% → метрика для продукта

---

## 13. Взаимодействие с другими модулями

| Модуль | Тип | Описание |
|--------|-----|----------|
| `01-auth` | Зависит | `verifyEmail` вызывает `initUserBootstrap`; `getMe` возвращает `nextRoute: '/onboarding'` |
| `02-tenant` | Зависит | `createTenant` вызывает `initTenantActivation` и завершает шаг `setup_company` |
| `03-team` | Интеграция | `createInvitation` триггерит auto-complete `invite_team` |
| `08-marketplace-accounts` | Интеграция | Подключение аккаунта триггерит `connect_marketplace` |
| `05-catalog` | Интеграция | Первый созданный товар триггерит `add_products` |

---

## 14. Правила и ограничения

- **BR-01**: Онбординг никогда не блокирует основную работу — все шаги рекомендательные.
- **BR-02**: Прогресс не теряется между сессиями и между устройствами — хранится только на backend.
- **BR-03**: Шаги связаны с реальными действиями в продукте через domain events.
- **BR-04**: `COMPLETED` — финальное состояние; нельзя "разкомплитить" онбординг.
- **BR-05**: Один USER_BOOTSTRAP на пользователя, один TENANT_ACTIVATION на tenant — принудительно на уровне БД.
- **BR-06**: Каталог шагов версионирован — изменение каталога не ломает существующих пользователей.

---

## 15. История изменений

| Дата | Изменение |
|------|-----------|
| 2026-04-26 | T4-01: схема БД, миграция, каталог шагов v1, базовый модуль |
| 2026-04-26 | Создан полноценный system-analytics.md |
| 2026-04-26 | Ревью аналитики: синхронизированы ключи шагов (`create_company` → `welcome` + `setup_company`), добавлены §7.4 error codes, §7.5 concurrency, §11.5 multi-tenant, поведение GET /state при null, роль POST /start, механизм check_stocks, приоритет blockReason, удаление tenant |
| 2026-04-26 | T4-01 ревью кода: race condition fix в init-методах (P2002 → re-fetch), обогащение StepDef полями `ctaLink` и `autoCompleteEvent` |
| 2026-04-26 | T4-02: State API — GET /state, POST /start, PATCH /steps/:stepKey, POST /close/reopen/complete; scope resolution, step state machine, formatResponse |
| 2026-04-26 | T4-03: Bootstrap-to-Tenant Handoff — verifyEmail→initUserBootstrap, createTenant→initTenantActivation+markStepDone(setup_company), auto-complete USER_BOOTSTRAP при создании компании |
| 2026-04-26 | T4-04: Domain events — TeamService→invite_team, SettingsService→connect_marketplace, ProductService→add_products; OnboardingModule добавлен в TeamModule/SettingsModule/ProductModule |
| 2026-04-26 | T4-05: Access-state guards + role-aware availability — TenantAccessContext, computeBlockReason, assertTenantWriteAllowed; isCtaBlocked/isBlocked/blockReason вычисляются из реального контекста |
| 2026-04-26 | T4-06: Frontend wizard — api/onboarding.ts клиент, OnboardingPage (USER_BOOTSTRAP 2-step wizard с resume), OnboardingWidget (TENANT_ACTIVATION floating panel, deep links, blocked state) |
| 2026-04-26 | T4-07: QA regression пакет — 75 тестов onboarding.service.spec.ts (state machine, domain events, handoff, access control, access-state guards, observability); checkStuckSteps() для alerting по onboarding_step_stale |
