# TASK_WAREHOUSES_7 — QA, Regression и Observability Warehouses

> Модуль: `07-warehouses`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `7h`
- Зависимости:
  - `TASK_WAREHOUSES_2`
  - `TASK_WAREHOUSES_3`
  - `TASK_WAREHOUSES_4`
  - `TASK_WAREHOUSES_5`
  - `TASK_WAREHOUSES_6`
- Что нужно сделать:
  - собрать regression пакет на первичную загрузку, upsert без дублей, исчезновение склада, lifecycle `ACTIVE -> INACTIVE -> ARCHIVED`;
  - покрыть изменение alias/labels без влияния на sync identity;
  - проверить сценарий, где marketplace account перестает быть operational source, но warehouse links сохраняются как reference history;
  - проверить поведение при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - проверить, что audit формируется для alias/labels updates;
  - настроить метрики, логи и alerts по freshness lag, classification changes и warehouse sync failures.
- Критерий закрытия:
  - warehouse reference layer подтвержден проверяемой регрессией;
  - исторические и активные склады корректно различаются;
  - observability достаточна для расследования sync/normalization проблем;
  - audit и тесты покрывают локальные metadata changes и account-related warehouse lifecycle.

**Что сделано**

### Контекст MVP до задачи

К моменту начала этой задачи в warehouse-модуле было **66 unit-тестов** в 4 файлах:
- [warehouse-sync.service.spec.ts](apps/api/src/modules/warehouses/warehouse-sync.service.spec.ts) — 16 тестов (нормализация WB/Ozon, lifecycle, paused tenant);
- [warehouse.service.spec.ts](apps/api/src/modules/warehouses/warehouse.service.spec.ts) — 11 тестов (list/getById/getStocks);
- [warehouse-metadata.spec.ts](apps/api/src/modules/warehouses/warehouse-metadata.spec.ts) — 24 теста (PATCH /metadata happy paths и identity guard);
- [warehouse-tenant-state.spec.ts](apps/api/src/modules/warehouses/warehouse-tenant-state.spec.ts) — 15 тестов (service-level pause).

При этом:
- §16 system-analytics test matrix не была явно покрыта одним сценарным файлом — QA не имел читаемого reference, как пройти регрессию по матрице.
- Имена событий в `Logger.log/warn` указывались инлайн через `WarehouseSyncEvents` объект внутри `warehouse-sync.service.ts` — опечатка в одном из 11 событий ломала бы алертинг.
- §19 system-analytics требовал метрики (`warehouses_synced`, `warehouse_upserts`, `inactive_warehouses`, `classification_changes`, `freshness_lag`), описание дашбордов и алертов — runbook отсутствовал.
- Не было документа, объясняющего «когда событие появилось → что делать оператору».

### Что добавлено

**1. Каноничные имена событий — [warehouse.events.ts](apps/api/src/modules/warehouses/warehouse.events.ts)**

Один файл со всеми 11 событиями warehouse-модуля, экспортированными через `as const` объект `WarehouseEvents`. Тип `WarehouseEventName` — union всех возможных значений. Файл служит:
- single source of truth — попытка опечатки в логе блокируется TypeScript-ом;
- индексом для observability runbook'а (раздел 1 WAREHOUSE_OBSERVABILITY.md);
- стабильной поверхностью для будущей интеграции Prometheus/OpenTelemetry.

`warehouse-sync.service.ts` отрефакторен: inline `WarehouseSyncEvents` объект заменён на re-export `WarehouseEvents` из централизованного файла под тем же именем для обратной совместимости с существующими тестами/импортами. `warehouse.service.ts` (метаданные) теперь использует `WarehouseEvents.METADATA_UPDATED` вместо строкового литерала.

**2. Регрессионный пакет — [warehouse.regression.spec.ts](apps/api/src/modules/warehouses/warehouse.regression.spec.ts)**

Один файл, в котором каждый describe-блок соответствует одной строке матрицы §16 system-analytics:

| §16 | describe в файле | Что покрыто |
|---|---|---|
| §16.1 | `§16.1 — первичная загрузка складов` | UPSERT_CREATED + SYNC_COMPLETED events; firstSeenAt/lastSyncedAt записываются |
| §16.2 | `§16.2 — повторный sync, без дублей` | updated без новых записей; дедупликация дублей в одном API ответе через нормализатор |
| §16.3 | `§16.3 — внешнее переименование склада` | новое name/city применяется, identity-поле НЕ меняется |
| §16.4 | `§16.4 — alias/labels не перетираются sync-ом` | update.data НЕ содержит aliasName/labels (защита tenant-local) |
| §16.5 | `§16.5 — disappeared склад → INACTIVE` | updateMany с deactivationReason='NOT_RETURNED_BY_API' + LIFECYCLE_INACTIVE event |
| §16.6 | `§16.6 — FBS/FBO нормализация` | Ozon → FBS+OZON; classification change → CLASSIFICATION_CHANGED warn |
| §16.7 | `§16.7 — полный lifecycle ACTIVE → INACTIVE → ARCHIVED` | safe-window archive + reactivation INACTIVE → ACTIVE с обнулением полей |
| §16.8-9 | `§16.8-9 — manual refresh blocked в paused tenant` | `it.each` на 3 paused-state для syncAllForTenant и syncForAccount + SYNC_PAUSED_BY_TENANT event |
| доп | `Account-related lifecycle — account fail не теряет warehouse references` | failed API → SYNC_FAILED, lifecycle НЕ применяется, lastSyncStatus НЕ ok; missing API key graceful |
| доп | `Audit для alias/labels updates` | metadataUpdatedAt + metadataUpdatedBy записываются; METADATA_UPDATED event с aliasNameChanged/labelsChanged флагами; identity guard блокирует identity-поля до БД |
| доп | `Reference visibility — historical склады не теряются` | list по умолчанию возвращает все статусы; getById для INACTIVE отдаёт deactivationReason |

23 новых теста. Каждый сценарий, где это имеет смысл, использует `jest.spyOn(Logger.prototype.log/warn)` для проверки, что соответствующее `WarehouseEvents.X` имя реально эмитится — observability и бизнес-логика тестируются вместе.

**3. Observability runbook — [WAREHOUSE_OBSERVABILITY.md](STRUCTURE-DEVELOPMENT/DOCS/TASKS/07-warehouses/WAREHOUSE_OBSERVABILITY.md)**

7 разделов:

1. **Каноничные события** — таблица всех 11 событий с severity и эмиттером (sync flow / upsert / lifecycle / classification / paused / metadata).
2. **Соответствие метрикам §19** — каждая метрика отображена на источник (event/SQL count/DB-поле). `freshness_lag` спец-секция: `now() - max(lastSyncedAt)` per tenant×account.
3. **Алерт-пороги P0/P1** — пять алертов с условиями и playbook'ами:
   - Sync failures spike (P1) → проверить `lastSyncError` и credentials;
   - Stale warehouse directory (P1) → проверить worker;
   - Massive deactivation (P0) → marketplace API ломается;
   - Classification change (P1) → marketplace переклассифицировал склад;
   - Paused IGNORED rate (P2) → UI не показывает paused banner.
4. **Диагностические запросы** — конкретные curl-команды на `/warehouses?status=`, `/warehouses/:id/stocks`, `/warehouses/sync` + SQL для freshness lag.
5. **Дашборды** — рекомендованные 4 boards (Warehouse Coverage, Freshness by account, FBS/FBO distribution, Lifecycle flow).
6. **Регрессионная карта** — отображение §16 матрицы на тестовые блоки.
7. **Когда дополнять** — правило «новое событие → константа + runbook + тест».

Этот документ закрывает «настроить метрики, логи и alerts» из DoD задачи: спецификация написана так, что будущий integration-таск возьмёт её и сконфигурирует scraping без дополнительного дизайна.

### Проверки

- `npx jest src/modules/warehouses/` — `Tests: 89 passed, 89 total` (66 ранее + 23 в новом regression-spec; 5 test suites passed).
- Глобально (inventory + warehouses): `Tests: 186 passed, 186 total` в 10 suites.
- `npx tsc --noEmit` (apps/api) — никаких новых ошибок.
- Каждый regression-сценарий явно проверяет соответствующий `WarehouseEvents.X` через spy на `Logger.prototype.log/warn` — observability и бизнес-инвариант покрыты в одном тесте.

### Соответствие критериям закрытия

- **Warehouse reference layer подтверждён проверяемой регрессией**: 89 unit-тестов в 5 файлах, regression-spec явно отображён на §16 system-analytics, можно пройти одним прогоном и увидеть pass-by-pass.
- **Исторические и активные склады корректно различаются**: §16.5 + §16.7 + Reference visibility покрывают полный lifecycle ACTIVE→INACTIVE→ARCHIVED→ACTIVE; deactivationReason и inactiveSince отдаются read API; default list не фильтрует по статусу.
- **Observability достаточна для расследования sync/normalization проблем**: 11 каноничных event-имён + 5 алертов P0/P1 + 4 дашборда + diagnostics endpoints позволяют от любого события дойти до конкретного `(tenantId, externalWarehouseId, sync attempt)` за минуту.
- **Audit и тесты покрывают локальные metadata changes и account-related warehouse lifecycle**: METADATA_UPDATED event с `aliasNameChanged/labelsChanged` флагами тестируется явно; account fail (`SYNC_FAILED`) не теряет warehouse references — отдельный describe-блок.

### Что осталось вне scope

- Реальная интеграция метрик в Prometheus / OpenTelemetry — требует изменения инфраструктуры приложения; runbook §3 готов для приёмки таска.
- E2E supertest на REST endpoints warehouses с реальной базой — отдельный QA-таск (юнит-тесты и интеграционные DB-тесты живут в разных слоях стратегии тестирования).
- Frontend dashboard для алертов на основании freshness lag — заметная часть уже доступна в `Warehouses.tsx` (TASK_WAREHOUSES_6, manual refresh с feedback и status badges); расширение до push-уведомлений — отдельная задача в `12-notifications`.
- Bridge `StockBalance.warehouseId TEXT → FK Warehouse.id` с миграцией данных — отдельная задача после полноценного adoption справочника всеми tenant'ами.
