# Склады — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `07-warehouses`

## 1. Назначение модуля

Модуль предоставляет справочник складов, подтягиваемых из внешних каналов, и их использование в inventory-представлении (FBS/FBO раздельно).

### Текущее состояние (as-is)

- в текущем коде нет самостоятельного warehouses backend-модуля и отдельной страницы справочника складов;
- warehouse данные появляются косвенно через marketplace sync/settings контур и не выделены в полноценный reference layer;
- нормализация FBS/FBO и lifecycle inactive складов пока формализованы в документации сильнее, чем в коде.

### Целевое состояние (to-be)

- warehouses должны стать отдельным reference слоем для inventory, orders и sync;
- тип исполнения и источник склада должны нормализоваться независимо от marketplace-specific представления;
- история связей со складом не должна теряться даже после деактивации или исчезновения из внешнего API;
- справочник складов должен оставаться read-only по внешним атрибутам и зависеть от состояния marketplace account и tenant, но допускать локальные tenant-метки и alias без изменения external truth.


## 2. Функциональный контур и границы

### Что входит в модуль
- хранение справочника внешних складов tenant;
- нормализация warehouse metadata из marketplace API;
- классификация FBS/FBO и вспомогательных атрибутов;
- lifecycle reference records: active, inactive, archived;
- отдача warehouse scope в inventory и UI;
- объяснение пользователю, почему склад неактуален или недоступен.

### Что не входит в модуль
- расчет остатков и транзакции stock movement;
- логика заказов и fulfillment исполнения;
- физические операции WMS;
- полноценный MDM по логистическим объектам.

### Главный результат работы модуля
- внешние склады представлены в системе как единый справочник, на который можно безопасно ссылаться в inventory, orders и аналитике.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Sync/Marketplace adapters | Импортируют данные складов | Источник истины по raw metadata |
| Owner/Admin/Manager | Просматривают и используют склад в UI | Могут задавать только внутренние alias/labels, не редактируя внешние идентификаторы |
| Inventory module | Использует warehouse reference | Не владеет жизненным циклом справочника |
| Support/Admin | Диагностируют проблемные mappings | Не должны ломать внешнюю связность без причины |

## 4. Базовые сценарии использования

### Сценарий 1. Первичная загрузка складов
1. При первом подключении account запускается warehouse sync.
2. Внешние записи нормализуются в internal warehouse model.
3. Каждому складу присваивается tenant scope и marketplace account scope.
4. UI получает список складов для работы с остатками.

### Сценарий 2. Обновление справочника
1. Регулярный sync получает актуальный список складов.
2. Существующие записи upsert-ятся по external id.
3. Пропавшие склады переводятся в inactive/archived по политике.
4. Исторические связи с inventory не теряются.

### Сценарий 3. Классификация FBS/FBO
1. Adapter получает тип склада из API или derive rule.
2. Сервис нормализует значение в внутренний enum.
3. Inventory/Orders используют эту классификацию для бизнес-логики.

## 5. Зависимости и интеграции

- Marketplace Accounts (источник складов)
- Sync (периодическое обновление справочника)
- Inventory (остатки в разрезе складов)
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/warehouses` | User | Список складов tenant |
| `GET` | `/api/v1/warehouses/:warehouseId` | User | Карточка склада |
| `GET` | `/api/v1/warehouses/:warehouseId/stocks` | User | Остатки по складу |
| `PATCH` | `/api/v1/warehouses/:warehouseId/metadata` | Owner/Admin/Manager | Обновление внутренних alias/labels |
| `POST` | `/api/v1/warehouses/sync` | Owner/Admin | Ручной refresh справочника складов |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/warehouses?marketplace=WB&type=FBS' \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "items": [
    {
      "id": "wh_...",
      "name": "WB Коледино",
      "city": "Москва",
      "type": "FBS",
      "marketplace": "WB"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

### Frontend поведение

- Текущее состояние: в web-клиенте нет выделенной страницы склада и фильтрации по warehouse type.
- Целевое состояние: нужен справочник складов с фильтрами по аккаунту, типу, активности и источнику.
- UX-правило: FBS и FBO не должны визуально смешиваться, иначе downstream inventory интерпретация будет ошибочной.
- inactive/archived склад должен оставаться видимым как reference-объект с понятным статусом;
- пользователь может задать внутренний alias и labels для удобства поиска и группировки, но не может менять внешний тип, источник и external id;
- при `TRIAL_EXPIRED` справочник складов доступен для чтения, но ручной refresh из UI запрещен;
- при `SUSPENDED` и `CLOSED` пользователь видит только read-only состояние без запуска refresh и действий, требующих внешнего API.

## 8. Модель данных (PostgreSQL)

### `warehouses`
- `id UUID PK`, `tenant_id UUID`
- `marketplace_account_id UUID FK`
- `external_warehouse_id VARCHAR(128) NOT NULL`
- `name VARCHAR(255) NOT NULL`, `city VARCHAR(128) NULL`
- `warehouse_type ENUM(fbs, fbo)`
- `source_marketplace ENUM(wb, ozon, yandex_market)`
- `alias_name VARCHAR(255) NULL`
- `labels TEXT[] NOT NULL DEFAULT '{}'`
- `status ENUM(active, inactive, archived) NOT NULL DEFAULT 'active'`
- `deactivation_reason VARCHAR(64) NULL`
- `last_synced_at TIMESTAMPTZ`
- `first_seen_at TIMESTAMPTZ NOT NULL`
- `inactive_since TIMESTAMPTZ NULL`
- `metadata_updated_at TIMESTAMPTZ NULL`
- `metadata_updated_by UUID NULL`
- `UNIQUE(tenant_id, marketplace_account_id, external_warehouse_id)`

## 9. Сценарии и алгоритмы (step-by-step)

1. Sync job получает список складов из каждого account.
2. Выполняется upsert `warehouses` по `(tenant, account, external_id)`.
3. Тип FBS/FBO вычисляется правилами интеграции и сохраняется явно.
4. Если склад пропал из внешнего API, он переводится в `inactive`, а не удаляется сразу.
5. Пользовательские `alias_name` и `labels` хранятся отдельно от sync-полей и не перетираются внешней синхронизацией.
6. Inventory API использует `warehouse_type` и `status` для раздельного отображения.

## 10. Валидации и ошибки

- Ручное создание/удаление складов через API запрещено в MVP.
- Ручное изменение `external_warehouse_id`, `warehouse_type`, `source_marketplace`, `name/city` из внешнего канала запрещено в MVP.
- Разрешено менять только `alias_name` и `labels` внутри tenant scope.
- Ручной refresh через UI запрещен при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
- Ошибки:
  - `NOT_FOUND: WAREHOUSE_NOT_FOUND`
  - `FORBIDDEN: WAREHOUSE_REFRESH_BLOCKED_BY_TENANT_STATE`
  - `VALIDATION_ERROR: WAREHOUSE_METADATA_TOO_LONG`
  - `EXTERNAL_INTEGRATION_ERROR: WAREHOUSE_SYNC_FAILED`

## 11. Чеклист реализации

- [x] Таблица `warehouses`. *(TASK_WAREHOUSES_1, 2026-04-26 — модель Warehouse + 3 enum (WarehouseType/Status/SourceMarketplace), UNIQUE(tenantId, marketplaceAccountId, externalWarehouseId), FK на Tenant/MarketplaceAccount/User, индексы для UI/sync, lifecycle поля firstSeenAt/lastSyncedAt/inactiveSince/deactivationReason, tenant-local aliasName/labels отдельно от sync-managed полей)*
- [x] Sync use-case `refresh warehouses`. *(TASK_WAREHOUSES_2, 2026-04-26 — модуль `apps/api/src/modules/warehouses/` с WarehouseSyncService, нормализаторы WB/Ozon в WarehouseSnapshot, idempotent upsert по UNIQUE TASK_1, disappeared lifecycle ACTIVE→INACTIVE→ARCHIVED через safe-window 30 дней, reactivation, защита tenant-local aliasName/labels, tenant-state pause skip, failed API не трогает lifecycle, 10 каноничных observability events; 16 тестов)*
- [x] API read-only для списка/деталей. *(TASK_WAREHOUSES_3, 2026-04-26 — WarehouseService.list/getById/getStocks + WarehouseController с GET /warehouses, GET /warehouses/:id, GET /warehouses/:id/stocks; фильтры marketplaceAccountId/sourceMarketplace/warehouseType/status/search; read-model контракт §15; bridge через externalWarehouseId до FK миграции; 11 тестов)*
- [x] API для обновления `alias_name` и `labels`. *(TASK_WAREHOUSES_4, 2026-04-26 — PATCH /warehouses/:id/metadata с RequireActiveTenantGuard + TenantWriteGuard; UpdateMetadataDto + service-level paranoid защита identity-полей; нормализация labels (trim/дедуп/regex/maxLength=64/maxCount=20), aliasName trim+empty→null+maxLength=255; audit metadataUpdatedAt/By + structured event warehouse_metadata_updated; 24 unit-теста, защита sync от перезаписи через regression `expect.not.objectContaining`)*
- [x] Привязка к inventory UI и фильтрам. *(TASK_WAREHOUSES_6, 2026-04-26 — новая web-страница `apps/web/src/pages/Warehouses.tsx` с master-detail layout: фильтры account/marketplace/type/status/search, manual refresh с UX-фидбеком, FBS/FBO визуально через цветные бейджи (синий/фиолетовый), INACTIVE/ARCHIVED со статус-иконками PauseCircle/Archive и видимой причиной, inline alias/labels editor с client+server validation, blocked/read-only UX через WRITE_BLOCKED_STATES, регистрация роута `/app/warehouses` и NavLink «Склады» в desktop+mobile навигации)*

## 12. Критерии готовности (DoD)

- Складской справочник полностью подтягивается из каналов.
- FBS/FBO не смешиваются в отображении.
- Модуль не изменяет внешние складские сущности маркетплейса.
- Внутренние alias/labels не ломают внешний mapping и не теряются после sync.
- Исторические склады не теряются после исчезновения из внешнего API.

## 13. Lifecycle warehouse reference

### Состояния
- `ACTIVE`
- `INACTIVE`
- `ARCHIVED`

### Переходы
- первичная синхронизация -> `ACTIVE`
- склад временно исчез из API или account перестал быть рабочим -> `INACTIVE`
- safe-window истек -> `ARCHIVED`

### Инварианты
- склад не является tenant-owned сущностью редактирования на MVP;
- локально редактируются только `alias_name` и `labels`, но не external metadata;
- любой warehouse всегда связан с конкретным `marketplace_account_id`;
- один и тот же внешний склад из разных account считается разными связями;
- переименование и удаление внешнего склада внутри платформы запрещены.

## 14. Схема обновления справочника

1. Worker получает warehouses из account API.
2. Нормализует ответ в канонический DTO.
3. Выполняет upsert в `warehouses`.
4. Для более не возвращаемых складов ставит `status=inactive` только после safe-window, а не мгновенно.
5. Долго не возвращающиеся склады переводятся в `archived`.

## 15. Контракты с inventory

### Read-model для inventory UI
- `warehouse_id`
- `warehouse_type`
- `source_marketplace`
- `city`
- `alias_name`
- `labels`
- `status`
- `deactivation_reason`

### Для детализации по складу
- inventory layer должен уметь агрегировать остатки в разрезе `warehouse_id`

### Правила интерпретации
- `ACTIVE` склады участвуют в стандартных operational views;
- `INACTIVE` и `ARCHIVED` не должны маскироваться под актуальный рабочий контур;
- inventory не должен терять исторические ссылки на склад, даже если он больше не приходит из внешнего API.

## 16. Тестовая матрица

- Первичная загрузка складов.
- Повторная синхронизация без дублей.
- Изменение названия склада во внешнем канале.
- Изменение `alias_name` и `labels` без влияния на sync identity.
- Исчезновение склада из API.
- Корректное разделение FBS/FBO.
- Переход `ACTIVE -> INACTIVE -> ARCHIVED`.
- Блокировка ручного refresh в `TRIAL_EXPIRED`.
- Блокировка ручного refresh в `SUSPENDED/CLOSED`.

## 17. Фазы внедрения

1. Таблица `warehouses`.
2. Sync use-case и нормализация ответов каналов.
3. Read API для UI.
4. Детализация stock-by-warehouse.

## 18. Нефункциональные требования и SLA

- Обновление справочника складов должно выполняться асинхронно и не блокировать пользовательские операции.
- Read API справочника должен быть быстрым: `p95 < 300 мс`.
- Внешние идентификаторы складов должны быть immutable в рамках account scope.
- Исторические ссылки на warehouse не должны теряться даже при его деактивации.
- Warehouse normalization должна быть идемпотентной и давать одинаковый результат при повторной синхронизации одного и того же ответа API.

## 19. Observability, логи и алерты

- Метрики: `warehouses_synced`, `warehouse_upserts`, `inactive_warehouses`, `classification_changes`, `freshness_lag`.
- Логи: import/upsert результатов, типовые ошибки normalization, account-specific anomalies.
- Алерты: отсутствие обновления справочника, массовые type changes, рост unknown classification.
- Dashboards: warehouse coverage, freshness by account, FBS/FBO distribution.

## 20. Риски реализации и архитектурные замечания

- Справочник складов не должен стать “вторым inventory”; его ответственность только reference/model layer.
- При изменении внешних атрибутов нужна стабильная нормализация, иначе downstream-модули будут дергаться от шума.
- Нужно заранее описать жизненный цикл disappeared warehouse, чтобы не было произвольного hard delete.
- Если один marketplace возвращает неоднозначные типы складов, классификация должна быть explainable и versioned.
- Пользовательские alias/labels допустимы только как локальная надстройка; если дать им право менять внешнюю идентичность склада, модуль начнет смешивать external truth и внутреннюю ручную семантику.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю warehouses больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Warehouse lifecycle и его связь с inventory описаны явно.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Доработаны warehouse lifecycle, tenant-state guards и открытый вопрос по внутренним меткам складов | Codex |
| 2026-04-18 | Подтверждены внутренние alias/labels для складов как локальная tenant-метадата без изменения external truth | Codex |
| 2026-04-26 | TASK_WAREHOUSES_7 выполнен: каноничные имена observability-событий вынесены в `apps/api/src/modules/warehouses/warehouse.events.ts` (11 констант через `as const`), сервисы отрефакторены — `WarehouseSyncEvents` теперь re-export `WarehouseEvents` для обратной совместимости, `WarehouseService.updateMetadata` использует `WarehouseEvents.METADATA_UPDATED`; регрессионный пакет `warehouse.regression.spec.ts` явно покрывает все 9 строк тест-матрицы §16 (первичная загрузка, повторный sync без дублей, внешнее переименование, alias/labels не перетираются, disappeared INACTIVE, FBS/FBO normalization + classification change, full lifecycle ACTIVE→INACTIVE→ARCHIVED + reactivation, paused tenant manual + service-level, account-related lifecycle с failed API, audit metadata, reference visibility); каждый сценарий проверяет соответствующий `WarehouseEvents.X` через `jest.spyOn(Logger.prototype)` — observability-инварианты тестируются вместе с бизнес-логикой; runbook `WAREHOUSE_OBSERVABILITY.md` с соответствием §19 метрик источникам (events / SQL counts / DB-поля), 5 алертов P0/P1/P2 с playbook'ами (sync failures spike, stale directory, massive deactivation, classification change, paused IGNORED rate), диагностические curl/SQL запросы, 4 рекомендованных дашборда (Warehouse Coverage, Freshness by account, FBS/FBO distribution, Lifecycle flow); 23 новых теста, total warehouses suite **89 passed in 5 suites**, глобально **186 passed in 10 suites** | Claude |
| 2026-04-26 | TASK_WAREHOUSES_6 выполнен: новая web-страница `apps/web/src/pages/Warehouses.tsx` с master-detail UX — табличный список с фильтрами (поиск по name/aliasName/city, marketplace WB/Ozon/Я.Маркет, тип FBS/FBO, статус, ID аккаунта), кликабельные строки, pagination 50; FBS/FBO визуально разведены через `TYPE_TONE` (синий/фиолетовый) + source-marketplace бейджи `SOURCE_TONE` (фуксия/голубой/амбер); INACTIVE/ARCHIVED видны как reference-объекты со статус-иконками `PauseCircle/Archive` и видимой `deactivationReason`; detail-панель с inline-редактором alias (≤255) и labels (массив, regex `^[A-Za-z0-9_-]+$`, max 20 × max 64) — client-side валидация зеркалит backend, error-коды маппятся в локализованные сообщения; manual refresh button c topMessage feedback (created/updated/deactivated/archived/paused/errored); read-only/blocked UX через `WRITE_BLOCKED_STATES` (disabled кнопки + Lock-иконки + tooltip + бейдж в шапке); stocks-таблица для выбранного склада через `GET /:id/stocks`; регистрация роута `/app/warehouses` в App.tsx + NavLink «Склады» (Building2) в desktop sidebar и mobile bottom-nav; tsc/vite build чистые | Claude |
| 2026-04-26 | TASK_WAREHOUSES_5 выполнен: tenant-state guards для warehouse refresh — manual refresh endpoint'ы `POST /warehouses/sync` и `POST /warehouses/sync/account/:accountId` под `RequireActiveTenantGuard + TenantWriteGuard` (403 при TRIAL_EXPIRED/SUSPENDED/CLOSED); service-level pause guard в `WarehouseSyncService.syncForAccount` (defense-in-depth для прямых вызовов из jobs/scheduler/REPL минующих HTTP) — `paused: true` без HTTP, без БД-изменений, warn-event `warehouse_sync_paused_by_tenant_state`; read API (`list/getById/getStocks`) не зависит от accessState — справочник остаётся видимым в paused state (§16 task); external truth rules закреплены — никаких POST/DELETE warehouse, никакого PATCH lifecycle, никакого пути изменения identity-полей через API кроме sync; 15 новых unit-тестов, total `163 passed in 9 suites` | Claude |
| 2026-04-26 | TASK_WAREHOUSES_4 выполнен: PATCH /warehouses/:id/metadata — единственный write-путь для tenant-local полей; `WarehouseService.updateMetadata` + `UpdateMetadataDto`; защита идентичности через paranoid-проверку `Object.keys(dto)` в сервисе → `WAREHOUSE_METADATA_FIELD_NOT_ALLOWED` для попытки изменить identity-поля БЕЗ обращения к БД; нормализация labels (trim, дедупликация через Set, regex `^[A-Za-z0-9_-]+$`, max 64 chars × max 20 elements) с гранулярными error-кодами `WAREHOUSE_LABELS_TOO_MANY/INVALID/INVALID_TYPE`, `WAREHOUSE_LABEL_FORMAT_INVALID/INVALID_TYPE`, `WAREHOUSE_METADATA_TOO_LONG`; aliasName trim + пустая→null + max 255; audit metadataUpdatedAt + metadataUpdatedBy на каждом update; structured-event `warehouse_metadata_updated` с `aliasNameChanged/labelsChanged` флагами; контроллер защищён `RequireActiveTenantGuard + TenantWriteGuard` (paused tenant блокирует write); защита sync от перезаписи alias/labels уже покрыта regression-тестом из TASK_2 (`expect.not.objectContaining`); 24 unit-теста, total `148 passed in 8 suites` | Claude |
| 2026-04-26 | TASK_WAREHOUSES_3 выполнен: read-only API справочника складов — `WarehouseService.list/getById/getStocks` + `WarehouseController` под `/warehouses` с `RequireActiveTenantGuard`; фильтры `marketplaceAccountId/sourceMarketplace/warehouseType/status/search` (OR по name/aliasName/city, case-insensitive); pagination с hard cap 200; sort (status, name) — ACTIVE наверх; read-model контракт §15 точно (`warehouseType/status/aliasName/labels/deactivationReason`) без утечки внутренних audit-полей; `getStocks` агрегирует `StockBalance` через bridge `warehouseId == externalWarehouseId` (готов к замене на FK после миграции данных), `Math.max(0, available)` clamp, exclude soft-deleted продуктов, totals `{onHand, reserved, available}`; manual create/delete через REST не открыт по §10 policy; 11 unit-тестов, total `124 passed in 7 suites` | Claude |
| 2026-04-26 | TASK_WAREHOUSES_2 выполнен: новый модуль `apps/api/src/modules/warehouses/` (WarehousesModule + WarehouseSyncService + нормализаторы WB/Ozon в канонический `WarehouseSnapshot`); use-case `syncForAccount(accountId)` с idempotent upsert по UNIQUE TASK_1, защита `aliasName`/`labels` от sync-перезаписи (`expect.not.objectContaining` в тестах), classification-change warn-event `warehouse_classification_changed` при смене type/source; lifecycle § §13/§14: первичный sync → ACTIVE с `firstSeenAt`, disappeared → INACTIVE с `inactiveSince`+`deactivationReason='NOT_RETURNED_BY_API'`, safe-window 30 дней → ARCHIVED, reactivation INACTIVE/ARCHIVED → ACTIVE с обнулением lifecycle полей; **failed API не применяет lifecycle и не помечает lastSyncStatus=ok** — закрывает «account state не приводит к silent loss»; `syncAllForTenant(tenantId)` со skip для TRIAL_EXPIRED/SUSPENDED/CLOSED (paused-warn без HTTP); 10 каноничных observability events (`warehouse_sync_*`, `warehouse_upsert_*`, `warehouse_lifecycle_*`, `warehouse_classification_changed`); 16 unit-тестов | Claude |
| 2026-04-26 | TASK_WAREHOUSES_1 выполнен: модель Warehouse в schema.prisma + миграция `20260426100000_warehouses_data_model` со всеми полями §8 (external identity tenantId+marketplaceAccountId+externalWarehouseId с UNIQUE, sync-managed name/city/warehouseType/sourceMarketplace, tenant-local aliasName/labels[] DEFAULT [], lifecycle status/deactivationReason/firstSeenAt/lastSyncedAt/inactiveSince, audit metadataUpdatedAt+metadataUpdatedBy); 3 новых enum (WarehouseType FBS/FBO, WarehouseStatus ACTIVE/INACTIVE/ARCHIVED, WarehouseSourceMarketplace WB/OZON/YANDEX_MARKET); FK Tenant/MarketplaceAccount CASCADE, User SetNull; индексы для UI-фильтров (status, sourceMarketplace+warehouseType) и sync-job (marketplaceAccountId+status); FK на StockBalance.warehouseId намеренно НЕ добавлен — bridge отдельной задачей после первичного sync use case | Claude |
