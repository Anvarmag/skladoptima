# Warehouses — Observability Runbook

> Раздел: `07-warehouses`
> Последнее обновление: 2026-04-26 (TASK_WAREHOUSES_7)
> Связанные документы: `system-analytics.md` §19, `warehouse.events.ts`

Операционный справочник для warehouse-модуля: какие события эмитятся, каким
метрикам §19 они соответствуют, когда алерт должен срабатывать и какие
запросы запускать при инциденте.

## 1. Каноничные события

Все имена — константы в `apps/api/src/modules/warehouses/warehouse.events.ts`.
Сервисы (`WarehouseSyncService`, `WarehouseService`) эмитят structured-JSON
через `Logger.log/warn`. Поле `event` всегда совпадает с одной из констант.

| Событие | Severity | Эмиттер | Когда срабатывает |
|---|---|---|---|
| `warehouse_sync_started` | info | `WarehouseSyncService.syncForAccount` | Начало sync для одного аккаунта |
| `warehouse_sync_completed` | info | `WarehouseSyncService.syncForAccount` | Успешное завершение, в payload — счётчики created/updated/deactivated/archived/reactivated |
| `warehouse_sync_failed` | warn | `WarehouseSyncService.syncForAccount` | API вернул ошибку; lifecycle НЕ применяется |
| `warehouse_sync_paused_by_tenant_state` | warn | `WarehouseSyncService` (sync* methods) | TRIAL_EXPIRED/SUSPENDED/CLOSED — sync не выполняется |
| `warehouse_upsert_created` | info | `_upsertSnapshot` | Новый склад добавлен в справочник |
| `warehouse_upsert_updated` | info | `_upsertSnapshot` | Обновлены sync-managed поля существующего склада |
| `warehouse_lifecycle_inactive` | warn | `_markDisappeared` | ACTIVE → INACTIVE, склад не вернулся в API |
| `warehouse_lifecycle_archived` | warn | `_archiveStale` | INACTIVE → ARCHIVED после safe-window 30 дней |
| `warehouse_lifecycle_reactivated` | info | `_upsertSnapshot` | INACTIVE/ARCHIVED → ACTIVE при возврате в API |
| `warehouse_classification_changed` | warn | `_upsertSnapshot` | Изменение `warehouseType` или `sourceMarketplace` (тревожно — внешний канал отдаёт неконсистентные данные) |
| `warehouse_metadata_updated` | info | `WarehouseService.updateMetadata` | Tenant отредактировал alias/labels |

## 2. Соответствие метрикам §19 system-analytics

| Метрика §19 | Источник | Где брать |
|---|---|---|
| `warehouses_synced` | `warehouse_sync_completed` | rate(event='warehouse_sync_completed') / окно |
| `warehouse_upserts` | `warehouse_upsert_created` + `warehouse_upsert_updated` | sum(event ∈ {created, updated}) |
| `inactive_warehouses` | `warehouse_lifecycle_inactive` | count(StockBalance) либо count(Warehouse where status=INACTIVE) |
| `classification_changes` | `warehouse_classification_changed` | count event'ов в логе |
| `freshness_lag` | `Warehouse.lastSyncedAt` | `now() - max(lastSyncedAt)` per tenant×account |

## 3. Алерт-пороги (P0/P1)

Все пороги — спецификация для будущей интеграции с Prometheus/Grafana
(MVP не разворачивает их сейчас, runbook готов для приёмки таска).

| Алерт | Условие | Severity | Что делать |
|---|---|---|---|
| **Sync failures spike** | `warehouse_sync_failed` rate > 5 / час для одного tenant | P1 | Marketplace API вернул ошибку для нескольких аккаунтов подряд. Проверить `MarketplaceAccount.lastSyncError` и credentials. |
| **Stale warehouse directory** | `now() - max(lastSyncedAt) > 24h` для активного аккаунта | P1 | Sync задерживается. Проверить `MarketplaceAccount.lastSyncStatus`, статус worker'а. |
| **Massive deactivation** | `warehouse_lifecycle_inactive` rate > 10 / час | P0 | Что-то ломает marketplace API — массово склады «исчезают» и переходят в INACTIVE. Может быть смена API endpoint'а или временный сбой. Проверить `warehouse_sync_failed` события — failed sync НЕ должен маркировать INACTIVE, поэтому массовая INACTIVE = легитимно или баг нормализатора. |
| **Classification change** | хоть один `warehouse_classification_changed` за день | P1 | Marketplace переклассифицировал склад FBS↔FBO. Возможна нестабильность downstream-логики (особенно push). Зафиксировать как факт, оповестить product. |
| **Paused IGNORED rate** | `warehouse_sync_paused_by_tenant_state` rate > 100 / час для одного tenant | P2 | Tenant в TRIAL_EXPIRED, но sync продолжает дёргаться (например, manual-кнопка фронтенда). UI должен показывать banner — проверить, что paused-state доходит до пользователя. |

## 4. Диагностические запросы

Все требуют tenant-scoped доступ через `RequireActiveTenantGuard`.

### 4.1 Список складов с фильтром по статусу

```
GET /api/v1/warehouses?status=INACTIVE&limit=100
GET /api/v1/warehouses?status=ARCHIVED&limit=100
```

### 4.2 Карточка с deactivationReason / inactiveSince

```
GET /api/v1/warehouses/<id>
```

### 4.3 Stocks-агрегация по складу

```
GET /api/v1/warehouses/<id>/stocks
```

Возвращает `{ totals: {onHand, reserved, available}, items: [...], count }`.

### 4.4 Manual refresh

```
POST /api/v1/warehouses/sync                            # все аккаунты
POST /api/v1/warehouses/sync/account/<accountId>        # один аккаунт
```

Заблокировано `TenantWriteGuard` для TRIAL_EXPIRED/SUSPENDED/CLOSED → 403.
В paused-state response `{ paused: true, results: [] }`.

### 4.5 Поиск конкретного `warehouse_*` event'а в логах

Структурированный лог:
```
event: warehouse_lifecycle_inactive | warehouse_lifecycle_archived | ...
tenantId: <id>
externalWarehouseId: <id>
```

Для расследования стрелы lifecycle для конкретного склада: `grep externalWarehouseId=<X>` сужает до одного склада, далее последовательность event'ов даёт его историю.

### 4.6 Проверка свежести через DB

```sql
SELECT "marketplaceAccountId",
       MAX("lastSyncedAt")  AS last_sync,
       NOW() - MAX("lastSyncedAt") AS lag
FROM "Warehouse"
WHERE "tenantId" = $1 AND "status" = 'ACTIVE'
GROUP BY "marketplaceAccountId";
```

## 5. Дашборды (рекомендованный набор)

Когда будет интеграция с Grafana/аналог:

- **Warehouse Coverage**: count Warehouse per tenant×marketplace×status, с разбивкой ACTIVE/INACTIVE/ARCHIVED.
- **Freshness by account**: `now() - lastSyncedAt` heatmap per (tenant, account).
- **FBS/FBO distribution**: pie chart по `warehouseType` для каждого tenant.
- **Lifecycle flow**: count `lifecycle_inactive` / `lifecycle_archived` / `lifecycle_reactivated` events per day.

## 6. Регрессионная карта (тесты)

Покрытие §16 system-analytics test matrix:

| Сценарий §16 | Файл / describe |
|---|---|
| Первичная загрузка складов | `warehouse.regression.spec.ts §16.1` |
| Повторная синхронизация без дублей | `warehouse.regression.spec.ts §16.2` |
| Изменение названия склада во внешнем канале | `warehouse.regression.spec.ts §16.3` |
| `alias_name` и `labels` без влияния на sync identity | `warehouse.regression.spec.ts §16.4` |
| Исчезновение склада из API → INACTIVE | `warehouse.regression.spec.ts §16.5` |
| Корректное разделение FBS/FBO | `warehouse.regression.spec.ts §16.6` |
| Переход `ACTIVE → INACTIVE → ARCHIVED` | `warehouse.regression.spec.ts §16.7` |
| Блокировка manual refresh в TRIAL_EXPIRED/SUSPENDED/CLOSED | `warehouse.regression.spec.ts §16.8-9` |
| Account fail не теряет warehouse references | `warehouse.regression.spec.ts Account-related lifecycle` |
| Audit для alias/labels updates | `warehouse.regression.spec.ts Audit для alias/labels updates` |
| Reference visibility — historical склады в read API | `warehouse.regression.spec.ts Reference visibility` |

Дополнительно (unit-spec'ы per-операция):
- `warehouse-sync.service.spec.ts` — нормализация WB/Ozon, lifecycle transitions, tenant-state pause (16);
- `warehouse.service.spec.ts` — list/getById/getStocks read API (11);
- `warehouse-metadata.spec.ts` — PATCH /metadata happy paths и identity guard (24);
- `warehouse-tenant-state.spec.ts` — service-level pause check для прямых вызовов (15).

Совокупно: **89 тестов в 5 suites** (warehouses module).
Глобально (inventory + warehouses): **186 passed, 10 suites**.

## 7. Когда дополнять

Каждый раз, когда добавляется новый observable путь:
1. Новая константа в `warehouse.events.ts`.
2. Раздел в этом документе (соответствие метрике, severity, что делать).
3. Тест в `warehouse.regression.spec.ts` или соответствующем unit-spec.
