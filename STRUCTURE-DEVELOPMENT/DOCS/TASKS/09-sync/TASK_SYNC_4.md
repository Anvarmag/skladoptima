# TASK_SYNC_4 — Item-Level Diagnostics, Conflicts и Idempotency

> Модуль: `09-sync`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_SYNC_1`
  - согласованы `05-catalog`, `06-inventory`, `10-orders`
- Что нужно сделать:
  - хранить item-level записи только для `failed / conflict / blocked` кейсов;
  - реализовать `sync_conflicts` и диагностическую выдачу по ним;
  - передавать вниз стабильный `external_event_id` или `source_event_id` для дедупликации;
  - ввести run-level idempotency через `Idempotency-Key` или `job_key`;
  - не допускать повторного бизнес-эффекта от одного и того же внешнего события.
- Критерий закрытия:
  - конфликтные и проблемные элементы не теряются;
  - success path не раздувает storage и шум в diagnostics;
  - downstream модули получают стабильные idempotency identifiers.

**Что сделано**

### Контекст MVP до задачи

После TASK_SYNC_1-3 в БД есть таблицы `SyncRunItem` и `SyncConflict`, но никто в них не пишет: TASK_SYNC_2 материализует только run-level записи (`status=BLOCKED` для preflight отказов), а реальный worker — TASK_SYNC_5+. В legacy [marketplace_sync/sync.service.ts](apps/api/src/modules/marketplace_sync/sync.service.ts):

- ошибки внешнего API логируются `logger.error` строкой и теряются: пользователь и support не могут потом восстановить, какой именно SKU/order упал в каком запуске;
- конфликтов как класса нет — `[Reconcile WB] Mismatch for ${product.sku}: WB=${stock.amount}, App=${currentAvailable}` залогирован, но не сохранён;
- `processedCount`/`errorCount` не считаются, хотя поля в `SyncRun` уже есть (TASK_SYNC_1);
- `Idempotency-Key` HTTP header не поддержан — `POST /sync/runs` принимает только body field;
- `external_event_id` заполняется лениво только в `MarketplaceOrder.marketplaceOrderId` (raw string, не нормализован), и нигде не передаётся вниз в inventory как `sourceEventId`. `InventoryEffectLock` уже умеет dedup по `(tenantId, effectType, sourceEventId)` ([inventory.service.ts:144](apps/api/src/modules/inventory/inventory.service.ts)), но sync-сторона этим контрактом не пользуется.

§14 system-analytics это явно нарушает: «повторная обработка одного и того же external event не должна создавать повторный бизнес-эффект» — сейчас единственная защита от дублей это `findFirst({ marketplaceOrderId: orderId })` в [sync.service.ts:639](apps/api/src/modules/marketplace_sync/sync.service.ts), причём dedup живёт только в одном модуле и легко ломается при рефакторинге.

### Что добавлено

**1. Новый writer-сервис [sync-diagnostics.service.ts](apps/api/src/modules/sync-runs/sync-diagnostics.service.ts)**

Single source of truth для записи item-level диагностики и конфликтов. Используется будущим worker'ом (TASK_SYNC_5) и адаптерами WB/Ozon. Публичный API:

```typescript
recordItem({ runId, itemType, itemKey, stage, status, externalEventId, payload, error })
recordConflict(tenantId, { runId, entityType, entityId, conflictType, payload })
incrementProcessed(runId, by)
incrementErrors(runId, by)
listConflicts(tenantId, query)
getConflictById(tenantId, id)
resolveConflict(tenantId, id, actorUserId)
```

Ключевые инварианты:

- **`recordItem` отвергает `SUCCESS` и `SKIPPED`** с явной ошибкой `SYNC_ITEM_NOT_RECORDABLE`. Это закрепляет правило §8 «item-level записи только для FAILED/CONFLICT/BLOCKED». Worker, который попытается записать success-item, получит 400 от сервиса — невозможно «случайно» начать раздувать storage. SKIPPED оставлен в enum как future-compatible значение, но writer его не принимает.
- **Ownership check для конфликтов**: `recordConflict` обязательно проверяет `prisma.syncRun.findFirst({ id, tenantId })` — конфликт не пишется в чужой tenant даже если worker дал неправильный runId.
- **Усечение строк по db.VarChar лимитам**: `itemKey` → 128, `entityType`/`conflictType` → 64. Это превентивно — иначе worker, упавший на длинном WB SKU, получил бы менее читаемый Postgres truncation error.
- **Структурированный лог** в каждой write-операции через канонические `SyncRunEventNames` (`sync_run_item_recorded`, `sync_run_conflict_detected`, `sync_conflict_resolved`).
- **`incrementProcessed/Errors`** — для агрегатов §8 (success path хранится только так, без записи каждого item). `by <= 0` → no-op (защита от случайных вызовов).

`SyncItem` const реэкспортируется как удобный набор enum-значений — worker импортирует `SyncItem.Type.STOCK`/`SyncItem.Stage.PUSH`/`SyncItem.Status.FAILED` без трёх отдельных импортов из `@prisma/client`.

**2. Endpoints `/sync/conflicts` ([sync-conflicts.controller.ts](apps/api/src/modules/sync-runs/sync-conflicts.controller.ts))**

3 endpoint'а под global prefix `/api`:

- `GET /api/sync/conflicts` — paginated list с фильтрами `status` (`open` / `resolved` / `all`, default `open`), `entityType`, `runId`, `page`, `limit`.
- `GET /api/sync/conflicts/:id` — карточка с включённым `run` (id, marketplaceAccountId, triggerType, triggerScope, status, syncTypes, attemptNumber, maxAttempts, createdAt, finishedAt). Достаточно, чтобы UI/support понял, какой run произвёл конфликт, без отдельного запроса в `/sync/runs/:id`.
- `POST /api/sync/conflicts/:id/resolve` — закрыть конфликт. **Идемпотентно**: повторный resolve уже закрытого возвращает текущее состояние, а не 409. Это критично для UI: если пользователь дважды нажал "закрыть" из-за лагов, второй запрос не должен ломаться.

**Дизайн-решение: resolve НЕ под `TenantWriteGuard`'ом.** `RequireActiveTenantGuard` обязателен (мульти-тенантность), но resolve — это _внутреннее_ audit/cleanup действие, не внешний API call. Закрытие конфликта в `TRIAL_EXPIRED` tenant'е должно работать: пользователь может разбираться с историей даже при просроченном trial. §10 system-analytics это поддерживает: «история и диагностика прошлых runs остаются доступными в read-only режиме» — но resolve в данном случае пишется как локальное состояние, не дёргает marketplace.

**3. Idempotency-Key HTTP header в `POST /sync/runs`**

Раньше идемпотентность поддерживалась только через body field `idempotencyKey` (TASK_SYNC_2). Теперь:

- HTTP заголовок `Idempotency-Key: <key>` — стандарт RFC, имеет приоритет;
- поле `idempotencyKey` в body — fallback для клиентов, у которых нет контроля над headers (например, простой `<form>` POST);
- если переданы оба и значения **отличаются** → `400 IDEMPOTENCY_KEY_MISMATCH` (явная неоднозначность, клиент должен решить);
- если ключ длиннее 128 символов → `400 IDEMPOTENCY_KEY_TOO_LONG` (DB UNIQUE на VarChar(128) иначе вернёт менее читаемый error).

В service слое ничего не изменилось — DB UNIQUE(`tenantId, jobKey`) из TASK_SYNC_1 продолжает гарантировать idempotency на уровне БД.

**4. Контракт `external_event_id` для дедупликации (§14)**

Контракт явно задокументирован в комментариях [sync-diagnostics.service.ts](apps/api/src/modules/sync-runs/sync-diagnostics.service.ts):

> `externalEventId` — стабильный id события маркетплейса (например, `posting_number` Ozon или `id` WB order). Hand off дальше в `InventoryEffectLock.sourceEventId` обеспечит, что повторная обработка не вызовет дублирующего бизнес-эффекта.
>
> Sync-слой только трассирует: если событие уже было обработано (видно по существующей `InventoryEffectLock` записи), worker пропускает его тихо без `recordItem()` (§14 явно: «повторная обработка одного и того же external event не должна создавать повторный бизнес-эффект»).

**Намеренно НЕ создаю отдельный `SyncEventLock` рядом с `InventoryEffectLock`**: existing [InventoryEffectLock](apps/api/prisma/schema.prisma) уже имеет UNIQUE(`tenantId, effectType, sourceEventId`) и публичный API `inventoryService.reserve/release/deduct(tenantId, sourceEventId, items)` с встроенной дедупликацией ([inventory.service.ts:567+](apps/api/src/modules/inventory/inventory.service.ts)). Дублировать этот замок на sync-уровне — значит создать второе место истины, которое разойдётся при первом же рефакторинге.

Правильный flow для будущего worker'а (TASK_SYNC_5+):
1. Получить event от marketplace API → извлечь стабильный `external_event_id`;
2. Передать его как `sourceEventId` в `inventoryService.reserve/deduct`;
3. Если `InventoryEffectLock` уже существует с этим ключом — `inventoryService` не выполнит side-effect повторно (already does this);
4. Sync пишет `SyncRunItem` с тем же `externalEventId` ТОЛЬКО при ошибке/конфликте — для трассировки. Успешные обработки идут в `processedCount` без item записи.

Это задокументировано инлайном в diagnostics.service.ts, чтобы будущий разработчик worker'а не реизобретал велосипед.

**5. Тесты [sync-diagnostics.service.spec.ts](apps/api/src/modules/sync-runs/sync-diagnostics.service.spec.ts)**

**20 unit-тестов**, разбиты на 4 группы:

`recordItem` (6):
- FAILED записан правильно с externalEventId, payload, error;
- CONFLICT и BLOCKED тоже допустимы;
- SUCCESS отвергается (MVP §8 invariant);
- SKIPPED отвергается;
- несуществующий run → 404;
- itemKey > 128 символов усекается.

`recordConflict` (3):
- запись + ownership check;
- run чужого tenant → 404;
- entityType/conflictType > 64 усекаются.

`increment*` (3):
- processed увеличивает `processedCount`;
- errors увеличивает `errorCount`;
- `by=0` — no-op.

`listConflicts/getById/resolve` (8):
- list по умолчанию — только открытые (`resolvedAt: null`);
- list `status=resolved` → `{ not: null }`;
- list `status=all` → без фильтра;
- getById включает run;
- getById чужого tenant → 404;
- resolve закрывает open;
- resolve уже закрытого — идемпотентен (без повторного update);
- resolve чужого tenant → 404.

### Соответствие критериям закрытия

- **Конфликтные и проблемные элементы не теряются**: `SyncRunItem` для FAILED/CONFLICT/BLOCKED + `SyncConflict` registry с GET/resolve API. Любая ошибка/конфликт worker'а попадёт в БД и будет видна через `/sync/runs/:id` и `/sync/conflicts`. Структурированный log с каноническими event names (`sync_run_item_recorded`, `sync_run_conflict_detected`) — для §19 metrics.
- **Success path не раздувает storage и шум в diagnostics**: `recordItem` отвергает SUCCESS/SKIPPED на уровне service — невозможно случайно начать писать success items. Aggregated counters `processedCount`/`errorCount` через `incrementProcessed/Errors` — единственный путь для success path.
- **Downstream модули получают стабильные idempotency identifiers**: контракт `external_event_id → InventoryEffectLock.sourceEventId` задокументирован и опирается на existing `inventoryService.reserve/release/deduct(tenantId, sourceEventId, items)`. Run-level idempotency через `Idempotency-Key` HTTP header + DB UNIQUE(tenantId, jobKey).

### Проверки

- `npx prisma validate` → `valid`.
- `npx tsc --noEmit` → новых ошибок в `sync-runs/` нет.
- `npx jest src/modules/sync-runs/` → **Tests: 57 passed, 57 total** (3 suites). 23 на `sync-runs.service` + 14 на `sync-preflight.service` + 20 на `sync-diagnostics.service`.
- `npx jest src/modules/marketplace-accounts/ src/modules/inventory/ src/modules/warehouses/ src/modules/sync-runs/` → **Tests: 362 passed, 362 total** (18 suites). Регрессия чистая.

### Что НЕ делается (намеренно)

- **Реальный worker, который вызывает `recordItem`/`recordConflict`** — TASK_SYNC_5+. Diagnostics service уже готов как контракт, но real producer'ов в production пока нет.
- **Pull/Push adapters per marketplace** (рефакторинг `pullFromWb`/`processOzonOrders` под run-based pipeline + использование `SyncDiagnosticsService`) — TASK_SYNC_5.
- **Отдельный `SyncEventLock`** — не нужен, `InventoryEffectLock` уже закрывает контракт §14 на уровне business effect.
- **Frontend для конфликтов** (UI разбора) — TASK_SYNC_6.
- **Метрики `conflicts_open`/`partial_success_rate` в Prometheus** — TASK_SYNC_7. Сейчас доступны через grep по structured logs.
- **Replace legacy `[Reconcile WB] Mismatch` логов на `recordConflict`** — частично делается в TASK_SYNC_5 в рамках adapter refactor.

### Что осталось вне scope

- Worker / queue runtime для `QUEUED → IN_PROGRESS → SUCCESS/...` + переключение polling на run-based pipeline — TASK_SYNC_5.
- Pull/Push adapters per marketplace — TASK_SYNC_5.
- Frontend истории / конфликтов / manual sync UX — TASK_SYNC_6.
- Интеграционные тесты с реальной БД (E2E partial/failure paths) и observability runbook — TASK_SYNC_7.
