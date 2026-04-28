# TASK_NOTIFICATIONS_2 — Delivery Policy Engine, Mandatory Rules и Dispatch Orchestration

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_NOTIFICATIONS_1`
- Что нужно сделать:
  - реализовать внутренний dispatch orchestration pipeline;
  - закрепить policy types `instant`, `scheduled`, `throttled` для MVP;
  - исключить digest как пользовательскую функцию из MVP;
  - обеспечить, что mandatory `AUTH/BILLING/SYSTEM` alerts не могут быть полностью выключены preferences;
  - отделить доменные события от channel-specific dispatch decisions.
- Критерий закрытия:
  - delivery policy engine централизован и предсказуем;
  - mandatory alerts не теряются из-за пользовательских настроек;
  - MVP не усложняется digest-логикой.

**Что сделано**

Реализован полный delivery policy engine и dispatch orchestration pipeline согласно требованиям задачи и §9/§14 системной аналитики.

### Файловая структура

Создан новый модуль [apps/api/src/modules/notifications/](../../../../../apps/api/src/modules/notifications/):

```
notifications/
├── notification.contract.ts           — константы, типы, интерфейсы
├── notification-policy.service.ts     — policy engine
├── notification-orchestrator.service.ts — dispatch orchestration
├── notifications.service.ts           — публичный API для domain modules
└── notifications.module.ts            — NestJS модуль (зарегистрирован в AppModule)
```

### 1. notification.contract.ts

Определены константы и интерфейсы:

- **`MANDATORY_CATEGORIES`** — `Set<AUTH, BILLING, SYSTEM>`. Категории, которые не могут быть полностью подавлены preferences (§10).
- **`DEDUP_WINDOW_MS`** — 15 минут (§10 dedup window).
- **`MVP_CHANNELS`** — `Set<EMAIL, IN_APP>`. Только MVP каналы участвуют в channel selection (§22).
- **`THROTTLED_CATEGORIES`** — `Set<SYNC, INVENTORY>`. Повторяющиеся события этих категорий получают THROTTLED policy.
- **`PublishNotificationInput`** — интерфейс входного DTO для domain modules.
- **`DispatchPlan`** — результат policy engine (каналы + политики или `skippedByDedup=true`).
- **`DEFAULT_CHANNEL_PREFERENCES` / `DEFAULT_CATEGORY_PREFERENCES`** — fallback при отсутствии preferences у tenant'а.

### 2. notification-policy.service.ts — Policy Engine

Централизованный источник истины для трёх решений:

**Channel selection (метод `_selectChannels`):**
- Загружает `NotificationPreferences` tenant'а (fallback на дефолты при отсутствии записи).
- Парсит `channels` JSONB и `categories` JSONB.
- Если категория отключена в preferences + событие не mandatory → пустой список (подавлено).
- Собирает включённые MVP каналы из preferences.
- **Mandatory rule**: если `isMandatory=true` и IN_APP не попал в список → принудительно добавляется. Это гарантирует, что AUTH/BILLING/SYSTEM alerts всегда попадают хотя бы в in-app inbox, даже если owner отключил все каналы.

**Policy assignment (метод `_assignPolicy`):**
- `isMandatory=true` или `severity=CRITICAL` → **INSTANT** (без исключений).
- `SYNC` или `INVENTORY` с non-critical severity → **THROTTLED**.
- Остальные → **INSTANT**.
- **DIGEST исключён**: не используется ни в одном пути (§22 confirmed decision).
- **SCHEDULED зарезервирован**: не назначается orchestrator'ом в этой задаче; используется в TASK_NOTIFICATIONS_3+ для billing reminders.

**Dedup check (метод `_checkDedup`):**
- Только для non-mandatory событий с явным `dedupKey`.
- Ищет в БД событие с тем же `(tenantId, category, dedup_key)` в окне 15 минут.
- Исключает текущий `eventId`, чтобы свежесозданный event не считался дублём себя.
- Mandatory alerts не дедуплицируются (безопаснее дублировать critical alert, чем потерять).

### 3. notification-orchestrator.service.ts — Dispatch Orchestration

Принимает сохранённый `NotificationEvent`, вызывает policy engine:
- Если `skippedByDedup=true` → логирует и возвращает пустой массив (event сохранён для аналитики).
- Если `dispatches=[]` (каналы подавлены) → логирует suppression.
- Иначе → создаёт `NotificationDispatch` записи через `createMany` (атомарно).
- Логирует структурированный JSON с `event/eventId/channels/policies/count`.

Паттерн «event сохраняется первым — dispatch планируется вторым» обеспечивает: event всегда прослеживаем в истории, даже при ошибке dispatch.

### 4. notifications.service.ts — Публичный API

Единственная точка входа для domain modules:
- Принимает `PublishNotificationInput`.
- Вычисляет `isMandatory` по категории (через `MANDATORY_CATEGORIES`) или из явного override.
- Создаёт `NotificationEvent` в БД.
- Передаёт event в оркестратор.
- Если оркестратор бросил ошибку — не теряет event (§19 observability), логирует ошибку.

### 5. Регистрация в AppModule

`NotificationsModule` добавлен в `imports` [apps/api/src/app.module.ts](../../../../../apps/api/src/app.module.ts).

### Критерии закрытия задачи

- ✅ Delivery policy engine централизован в `NotificationPolicyService` — одна точка для channel selection, policy assignment и dedup.
- ✅ Mandatory alerts (AUTH/BILLING/SYSTEM) не теряются из-за preferences: IN_APP гарантирован как fallback.
- ✅ MVP не усложняется digest-логикой: DIGEST enum существует в схеме, но не используется ни в одном пути кода.
- ✅ Доменные события отделены от channel-specific решений: domain modules вызывают только `publishEvent()`, не зная ничего о каналах.
