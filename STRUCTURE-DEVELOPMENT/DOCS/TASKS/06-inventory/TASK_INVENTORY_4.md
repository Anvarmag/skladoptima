# TASK_INVENTORY_4 — Idempotency Locks, Reconciliation и Conflict Handling

> Модуль: `06-inventory`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_INVENTORY_1`
  - `TASK_INVENTORY_3`
  - согласованы `09-sync` и `18-worker`
- Что нужно сделать:
  - внедрить `inventory_effect_locks` для order/sync side-effects;
  - игнорировать повторное применение одного и того же business event;
  - реализовать конфликт-детектор устаревших внешних событий и reconciliation path;
  - зафиксировать политику optimistic/pessimistic locking для reserve path;
  - обеспечить наблюдаемость idempotency collisions и reserve/release mismatch.
- Критерий закрытия:
  - повторные события не меняют остаток повторно;
  - conflicts и stale external events диагностируются явно;
  - inventory выдерживает retry/replay без потери корректности.

**Что сделано**

### Контекст MVP до задачи

В MVP идемпотентности на уровне business event'ов вообще не было: каждый poll маркетплейсов в [sync.service.ts](apps/api/src/modules/marketplace_sync/sync.service.ts) делал `prisma.product.update({ data: { total: { decrement: qty } } })` напрямую, и единственная защита от двойного списания держалась на проверке `marketplaceOrder.findFirst({ marketplaceOrderId })` в начале цикла. Если процесс падал между decrement и `marketplaceOrder.create`, на следующей итерации остаток списывался повторно. Reconciliation-пути не существовало: входящий FBS stocks snapshot от WB просто перезаписывал каналные счётчики `wbFbs/wbFbo` через `MarketplaceSyncService`, без сравнения с локальным master-остатком и без отметки расхождений. Stale-event detection отсутствовала — устаревший snapshot от воркера, который запоздал на минуту, мог затереть свежие данные. Diagnostics-отчётов по idempotency collisions/conflicts не было.

TASK_INVENTORY_3 уже дал базовую идемпотентность через `InventoryEffectLock` для reserve/release/deduct/return-контрактов. Эта задача замыкает оставшиеся пять пунктов: reconcile path, stale detection, документ locking-policy, diagnostics endpoints, observability логи.

### Что добавлено

**1. Reconciliation-метод `InventoryService.reconcile` ([inventory.service.ts](apps/api/src/modules/inventory/inventory.service.ts))**

Сигнатура: `reconcile(tenantId, sourceEventId, snapshot: { productId, warehouseId?, externalAvailable, externalEventAt? }, opts?)`. Возвращает дискриминированный union статусов:

| status | смысл |
|---|---|
| `NO_CONFLICT` | внешний `available` совпадает с локальным — lock APPLIED, movement не пишется |
| `CONFLICT_LOGGED` | расхождение → `CONFLICT_DETECTED` movement (delta = `external - local`, before == after, остаток НЕ меняется), lock APPLIED |
| `IGNORED_STALE` | `externalEventAt` старше последнего marketplace movement по тому же scope — lock IGNORED, conflict не пишется |
| `IDEMPOTENT` | replay APPLIED lock — возвращается id ранее созданного `CONFLICT_DETECTED` movement |

Главное архитектурное решение из system-analytics §10/§13/§21 — **никакого silent overwrite**: расхождение фиксируется как diagnostics-факт, оператор сам решает выровнять баланс через manual adjustment.

Идемпотентность построена на тех же `_checkLock` / `_upsertLockProcessing` / `_markLockFailed` примитивах, что и order side-effects из TASK_INVENTORY_3. Lock использует `effectType=SYNC_RECONCILE`. Stale-detection runs до открытия write-транзакции, чтобы не платить локами на устаревшем событии.

Lazy-bridge с MVP: если `StockBalance` ещё не существует (tenant ни разу не использовал inventory write-path), сравнение делается с `Product.total - Product.reserved` через `_readLocalAvailable`.

**2. Locking policy в коде ([inventory.service.ts:55-77](apps/api/src/modules/inventory/inventory.service.ts#L55-L77))**

Зафиксирован header-комментарий `LOCKING POLICY (TASK_INVENTORY_4)`:

- **Pessimistic locking** (`SELECT ... FOR UPDATE`) для reserve/release/deduct path. Обоснование: высокая конкуренция (много webhooks/poll одновременно), optimistic retry увеличил бы хвостовую латентность.
- **Optimistic чтение** для reconcile path: операция read-only по семантике, небольшое расхождение в момент сравнения нормально для diagnostics-цели.
- Idempotency-замок (`InventoryEffectLock`) — отдельный UNIQUE-замок, обязательный для всех вызовов с `sourceEventId`.

Это контракт для будущих модулей (orders, sync) — они обязаны передавать стабильный `sourceEventId`.

**3. DTO и REST endpoints ([inventory.controller.ts](apps/api/src/modules/inventory/inventory.controller.ts), [dto/reconcile.dto.ts](apps/api/src/modules/inventory/dto/reconcile.dto.ts))**

| Метод | Endpoint | Guard | Назначение |
|---|---|---|---|
| `POST` | `/inventory/reconcile` | `RequireActiveTenantGuard` + `TenantWriteGuard` | Sync-driven сравнение snapshot |
| `GET` | `/inventory/effect-locks` | `RequireActiveTenantGuard` | Диагностика lock'ов с фильтрами `status`, `effectType`, pagination |
| `GET` | `/inventory/conflicts` | `RequireActiveTenantGuard` | Список `CONFLICT_DETECTED` movements (alias на listMovements) |
| `GET` | `/inventory/diagnostics` | `RequireActiveTenantGuard` | Сводный отчёт за 24h |

`POST /reconcile` под `TenantWriteGuard` — потому что фактически пишет `CONFLICT_DETECTED` movement (даже если остаток не меняется, это аудит-запись). При `TRIAL_EXPIRED/SUSPENDED/CLOSED` reconciliation запросы блокируются по той же policy, что и manual adjustments.

**4. Diagnostics endpoint `getDiagnostics` ([inventory.service.ts](apps/api/src/modules/inventory/inventory.service.ts))**

Возвращает за последние 24h:

```json
{
  "generatedAt": "2026-04-26T...",
  "window": "24h",
  "locks": { "processing": N, "applied": N, "ignored": N, "failed": N },
  "conflictsLast24h": N,
  "reserveReleaseFailedLast24h": N,
  "deductFailedLast24h": N
}
```

Покрывает все метрики из system-analytics §20:
- `inventory_conflicts` → `conflictsLast24h` (CONFLICT_DETECTED movements).
- `reserve_release_mismatch` → `reserveReleaseFailedLast24h` (FAILED locks для ORDER_RESERVE/ORDER_RELEASE — туда попадают `RELEASE_EXCEEDS_RESERVED` и `RESERVED_EXCEEDS_ONHAND`).
- `negative_stock_blocked` → `deductFailedLast24h` (FAILED locks для ORDER_DEDUCT).
- `repeated idempotency collisions` → видно через `locks.ignored` (replay'и) и `locks.processing` (stuck locks).

**5. Observability**

Новые structured-логи:
- `inventory_reconcile_conflict_detected` (warn) — расхождение зафиксировано, со всеми полями для алерта.
- `inventory_reconcile_stale_event_ignored` (warn) — устаревший event отброшен, с локальным/внешним timestamp.

Существующие логи из TASK_INVENTORY_3 (`inventory_order_effect_applied`, `inventory_order_effect_idempotent_replay`, `inventory_lock_mark_failed_error`, `inventory_return_logged`) продолжают работать.

**6. Тесты — [inventory.reconcile.spec.ts](apps/api/src/modules/inventory/inventory.reconcile.spec.ts)**

11 новых тестов в 2 describe-блоках:

*reconcile (9):* NO_CONFLICT при равных available; CONFLICT_LOGGED пишет движение с delta и не трогает остаток; IDEMPOTENT replay с возвратом ранее созданного movement id; IGNORED_STALE с upsert lock=IGNORED, без write-транзакции; not stale если externalEventAt новее локального; fallback на `Product.total/reserved` при отсутствии StockBalance; PRODUCT_NOT_FOUND; валидация `EXTERNAL_AVAILABLE_INVALID` на отрицательное и нецелое; обязательность `SOURCE_EVENT_ID_REQUIRED` и `SNAPSHOT_PRODUCT_ID_REQUIRED`.

*diagnostics (2):* listEffectLocks с pagination/фильтрами; getDiagnostics собирает корректные счётчики (locks/conflicts/failures) — проверены порядок и значения через 6 моков `count`.

Совокупный inventory test suite — `Tests: 48 passed, 48 total` (16 adjustments/listings + 21 order-effects + 11 reconcile/diagnostics).

`tsc --noEmit` — никаких новых ошибок.

### Соответствие критериям закрытия

- **Повторные события не меняют остаток повторно**: `InventoryEffectLock` UNIQUE-замок + pre-check (`APPLIED/IGNORED → IDEMPOTENT`, `PROCESSING → 409`, `FAILED → retry`). Reconcile дополнительно гарантирует, что повторный snapshot не плодит дубль `CONFLICT_DETECTED`.
- **Conflicts и stale external events диагностируются явно**: расхождение пишется как `CONFLICT_DETECTED` movement с полным комментарием (`external=N, local=M, diff=X`); устаревшее событие фиксируется в lock со статусом IGNORED + warn-лог; всё доступно через `GET /inventory/conflicts`, `GET /inventory/effect-locks`, `GET /inventory/diagnostics`.
- **Inventory выдерживает retry/replay без потери корректности**: pessimistic FOR UPDATE на reserve path (TASK_INVENTORY_3), stale-detection на reconcile path (эта задача), FAILED locks допускают retry без двойного применения, CHECK constraints в БД как страховка.

### Что осталось вне scope

- Подключение reconcile к `MarketplaceSyncService.syncWbStocks/syncOzonStocks` — TASK_INVENTORY_5 (там же замена прямого `Product.total.decrement` на `InventoryService.deduct`).
- Push effective `available` обратно в каналы после reconcile — TASK_INVENTORY_5.
- Frontend dashboard для diagnostics endpoint и conflicts board — TASK_INVENTORY_6.
- Алерты (rate-based) на conflicts/stuck PROCESSING locks — TASK_INVENTORY_7.
