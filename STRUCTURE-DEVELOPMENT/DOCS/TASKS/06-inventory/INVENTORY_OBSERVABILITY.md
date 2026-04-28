# Inventory — Observability Runbook

> Раздел: `06-inventory`
> Последнее обновление: 2026-04-26 (TASK_INVENTORY_7)
> Связанные документы: `system-analytics.md` §20, `inventory.events.ts`

Этот документ — операционный справочник: какие события эмитит inventory-модуль,
какие метрики из `system-analytics.md` §20 каким событием закрываются, какие
пороги алертов и какие диагностические запросы запускать при инциденте.

## 1. Каноничные события

Все имена событий — константы в `apps/api/src/modules/inventory/inventory.events.ts`.
Сервис эмитит structured-JSON через `Logger.log` / `Logger.warn`. Поле `event`
всегда соответствует одной из констант.

| Событие | Severity | Эмиттер | Когда срабатывает |
|---|---|---|---|
| `inventory_adjustment_applied` | info | `createAdjustment` | Успешная manual-корректировка |
| `inventory_adjustment_idempotent_replay` | info | `createAdjustment` | Повторный вызов с тем же `idempotencyKey` |
| `inventory_threshold_updated` | info | `updateThreshold` | Изменён low-stock порог |
| `inventory_order_effect_applied` | info | `_applyOrderEffect` | Успешный reserve/release/deduct |
| `inventory_order_effect_idempotent_replay` | info | `_applyOrderEffect` | APPLIED-lock замечен до транзакции |
| `inventory_order_effect_paused_by_tenant_state` | warn | `_applyOrderEffect` | Tenant в TRIAL_EXPIRED/SUSPENDED/CLOSED |
| `inventory_return_logged` | info | `logReturn` | Возврат зафиксирован (без auto-restock) |
| `inventory_return_paused_by_tenant_state` | warn | `logReturn` | Tenant paused, return проигнорирован |
| `inventory_reconcile_conflict_detected` | warn | `reconcile` | Расхождение local vs external — `CONFLICT_DETECTED` movement |
| `inventory_reconcile_stale_event_ignored` | warn | `reconcile` | `externalEventAt` старее последнего marketplace-движения |
| `inventory_reconcile_paused_by_tenant_state` | warn | `reconcile` | Tenant paused, sync-snapshot проигнорирован |
| `inventory_manual_write_blocked_by_tenant_state` | warn | `_assertManualWriteAllowed` | Прямой service-call минуя HTTP guard |
| `inventory_lock_mark_failed_error` | warn | `_applyOrderEffect` (catch) | Не удалось перевести lock в FAILED — нужно расследование |

## 2. Соответствие метрикам §20 system-analytics

| Метрика §20 | Источник | Откуда брать |
|---|---|---|
| `stock_movements_created` | `StockMovement.create` | count(StockMovement) или event `inventory_adjustment_applied` + `inventory_order_effect_applied` |
| `negative_stock_blocked` | `_applyOrderEffect` exception path | count(InventoryEffectLock where status=FAILED, effectType=ORDER_DEDUCT) — endpoint `/inventory/diagnostics.deductFailedLast24h` |
| `reserve_release_mismatch` | `_applyOrderEffect` exception path | count(InventoryEffectLock where status=FAILED, effectType IN (ORDER_RESERVE, ORDER_RELEASE)) — endpoint `/inventory/diagnostics.reserveReleaseFailedLast24h` |
| `low_stock_items` | `listLowStock` | поле `count` из ответа `GET /inventory/low-stock` |
| `inventory_conflicts` | `inventory_reconcile_conflict_detected` | count(StockMovement where movementType=CONFLICT_DETECTED) — endpoint `/inventory/diagnostics.conflictsLast24h` |
| `tenant_state_paused_effects` (доп) | `inventory_*_paused_by_tenant_state` | count(InventoryEffectLock where status=IGNORED) |
| `idempotency_collisions` | `inventory_order_effect_idempotent_replay` | счётчик event'ов в логе |

## 3. Алерт-пороги (P0/P1)

Все пороги — на rate за окно 24h. Реализация алертов выходит за рамки MVP
(нет Prometheus/Grafana на стороне проекта); этот раздел — спецификация для
будущей интеграции.

| Алерт | Условие (за 24h) | Severity | Что делать |
|---|---|---|---|
| **Negative stock blocks (deduct fail)** | `deductFailedLast24h > 5` | P0 | Расследовать `inventoryEffectLock` со status=FAILED, effectType=ORDER_DEDUCT — это марк, что к нам приходят deduct events на товары с недостаточным `onHand`. Часто означает рассинхрон с маркетплейсом. |
| **Reserve/release mismatch** | `reserveReleaseFailedLast24h > 5` | P0 | Аналогично, но смотреть FAILED locks с effectType=ORDER_RESERVE/ORDER_RELEASE. Чаще всего release > reserved или reserve больше чем `onHand` для FBS. |
| **Inventory conflicts spike** | `conflictsLast24h > 20` ИЛИ rate > 1/час | P1 | Marketplace push расходится с нашим master. Проверить, не отстал ли наш sync-задел. Каждый CONFLICT_DETECTED движение — фактически расхождение `external - local`. |
| **Stuck PROCESSING locks** | `locks.processing > 5` И возраст обновления > 5 мин | P0 | Воркер упал между upsert(PROCESSING) и update(APPLIED). Нужно либо retry, либо вручную перевести в FAILED, чтобы освободить sourceEventId. |
| **Tenant-paused IGNORED rate** | `locks.ignored > 100/час для одного tenant` | P1 | Tenant в TRIAL_EXPIRED, но marketplace продолжает слать события. Убедиться, что pause-banner показан, при необходимости отключить poll на стороне sync. |
| **Lock mark FAILED error** | event `inventory_lock_mark_failed_error` | P1 | Сам перевод в FAILED падает — обычно проблема с DB connection. Эскалировать. |

## 4. Диагностические запросы

Все запросы предполагают tenant-scoped доступ через `RequireActiveTenantGuard`.

### 4.1 Сводный отчёт за 24h

```
GET /api/v1/inventory/diagnostics
```

Возвращает `{ locks{processing/applied/ignored/failed}, conflictsLast24h, reserveReleaseFailedLast24h, deductFailedLast24h, window: '24h' }`.

### 4.2 Список FAILED locks (для расследования)

```
GET /api/v1/inventory/effect-locks?status=FAILED&limit=50
```

В ответе: `effectType`, `sourceEventId`, `updatedAt`. По `sourceEventId` можно
найти исходное событие в логах sync-сервиса.

### 4.3 Список CONFLICT_DETECTED movements

```
GET /api/v1/inventory/conflicts?from=2026-04-25T00:00:00Z&limit=100
```

Каждое движение содержит `delta = external - local`, `comment` с raw значениями,
`sourceEventId` исходного snapshot'а.

### 4.4 Movement history по конкретному SKU

```
GET /api/v1/inventory/movements?productId=<id>&limit=200
```

Полная история — manual + order events + returns + conflicts. Содержит
before/after `onHand`/`reserved`, `actorUser.email`, `reasonCode`.

### 4.5 Поиск конкретного sourceEventId в логах

Структурированные логи → grep на JSON-поле `sourceEventId`:

```
sourceEventId: <id>
event: <одно из inventory_*>
```

Например, для расследования двойного списания в логах находим оба
`inventory_order_effect_applied` или `inventory_order_effect_idempotent_replay` —
второй должен быть idempotent replay'ем.

## 5. Дашборды (рекомендованный набор)

Когда будет интеграция с Grafana/аналог:

- **Stock Health Board**: суммарный `onHand`, `reserved`, `available` по tenant
  + low-stock count + conflicts 24h.
- **Movement Anomaly Board**: rate `inventory_order_effect_applied` vs
  `_idempotent_replay` (соотношение должно быть стабильным; пик replay'ев =
  marketplace ретраит сильнее обычного, может предвещать проблему).
- **Side-effect Idempotency Board**: locks по статусам, distribution по
  `effectType`, MTBF между PROCESSING → APPLIED.
- **Source-of-Change Conflict Board** (см. catalog): доля
  `CONFLICT_DETECTED` movements vs total movements per tenant.

## 6. Регрессионная карта (тесты)

Покрытие §17 system-analytics test matrix:

| Сценарий §17 | Файл теста |
|---|---|
| Ручное увеличение остатка | `inventory.regression.spec.ts §17.1` |
| Ручное уменьшение до нуля | `inventory.regression.spec.ts §17.2` |
| Попытка ниже нуля | `inventory.regression.spec.ts §17.3` |
| Reserve двух заказов подряд | `inventory.regression.spec.ts §17.4` |
| Повтор того же `source_event_id` | `inventory.regression.spec.ts §17.5` |
| Cancel после reserve | `inventory.regression.spec.ts §17.6` |
| Fulfill после reserve | `inventory.regression.spec.ts §17.7` |
| Конфликт ручной корректировки и устаревшего внешнего события | `inventory.regression.spec.ts §17.8` |
| Manual adjust в TRIAL_EXPIRED / SUSPENDED / CLOSED | `inventory.regression.spec.ts §17.9-10` |
| Order side-effect в paused tenant | `inventory.regression.spec.ts §16+17` |
| Return — no auto-restock | `inventory.regression.spec.ts Return logging` |
| Reconciliation — CONFLICT_DETECTED без overwrite | `inventory.regression.spec.ts Reconciliation` |
| FBS/FBO boundary §14 | `inventory.regression.spec.ts FBS/FBO boundary` |
| Diagnostics rollup §20 | `inventory.regression.spec.ts §20 Observability` |
| Low-stock contract для notifications | `inventory.regression.spec.ts Low-stock contract` |
| Validation matrix | `inventory.regression.spec.ts Validation matrix` |

Дополнительно:
- Подробные unit-тесты per-операция: `inventory.service.spec.ts`,
  `inventory.orders.spec.ts`, `inventory.reconcile.spec.ts`,
  `inventory.tenant-state.spec.ts`.
- Совокупно: **97 тестов в 5 файлах**.

## 7. Когда дополнять

Каждый раз, когда добавляется новый observable путь:
1. Новая константа в `inventory.events.ts`.
2. Раздел в этом документе (соответствие метрике, severity, что делать).
3. Тест в `inventory.regression.spec.ts` или соответствующем unit-spec.
