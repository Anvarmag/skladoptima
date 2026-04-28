# Заказы — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-26
> Связанный раздел: `10-orders`

## 1. Назначение модуля

Модуль хранит и отображает заказы из маркетплейсов, маппит внешние статусы во внутренние и инициирует бизнес-эффект на остатки только для FBS-заказов.

### Текущее состояние (as-is)

- в web-клиенте уже есть страница `Orders`, но выделенного backend-модуля orders в текущем коде нет;
- часть order-данных сейчас читается через sync слой, а не из самостоятельного orders domain;
- внутренняя state machine, order events и side effects inventory пока зафиксированы в спецификации как следующий слой зрелости.

### Целевое состояние (to-be)

- orders должны стать отдельным доменным модулем с ingestion, internal state machine и timeline событий;
- заказы должны быть источником управляемых reserve/release/deduct side effects только по допустимым правилам;
- orders должны уважать `tenant AccessState` и effective runtime state marketplace account: при paused integration новые внешние order events не должны создавать side-effects "обходным путем";
- дубли внешних событий не должны приводить к повторному бизнес-эффекту.


## 2. Функциональный контур и границы

### Что входит в модуль
- ingestion заказов из маркетплейсов;
- нормализация order header/items/status;
- внутренняя state machine заказа;
- side-effects для inventory и аналитики;
- provenance каждого внешнего события и связь с `sync_run`;
- диагностика duplicate/out-of-order событий.

### Что не входит в модуль
- биллинг покупателя и внешняя касса;
- полноценный OMS/CRM для клиентской коммуникации;
- физическое выполнение и shipping orchestration beyond marketplace statuses;
- финансовый расчет прибыли.

### Главный результат работы модуля
- все внешние заказы tenant представлены как единая доменная модель, по которой можно безопасно строить inventory effects, аналитику и операционные списки.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Sync/Marketplace adapters | Доставляют raw order events | Не применяют бизнес-эффект напрямую |
| Owner/Admin/Manager | Просматривают заказы и статусы | Обычно не редактируют сырой заказ вручную |
| Inventory module | Реагирует на order state changes | Не является источником истины по заказу |
| Marketplace Account policy | Определяет, можно ли принимать новые внешние события | Не меняет уже сохраненную историю заказов |
| Analytics/Finance | Читают нормализованные orders | Не меняют lifecycle заказа |

## 4. Базовые сценарии использования

### Сценарий 1. Появление нового заказа
1. Sync доставляет новый external order.
2. Orders service проверяет идемпотентность по external key.
3. Создает order header и order items.
4. Если сценарий влияет на stock, публикует reserve event.
5. Заказ появляется в UI и аналитике.

### Сценарий 2. Обновление статуса заказа
1. Система получает внешний статус change event.
2. Выполняется mapping во внутренний state.
3. Если state change влияет на inventory, создается соответствующий side-effect.
4. История переходов сохраняется.

### Сценарий 3. Duplicate/out-of-order event
1. Сервис получает повторный или устаревший event.
2. По fingerprint/version policy определяется, есть ли новый бизнес-эффект.
3. Если эффекта нет, событие логируется как duplicate/ignored.
4. Повторного reserve/deduct не происходит.

### Сценарий 4. Tenant уходит в `TRIAL_EXPIRED`
1. Tenant переводится в `TRIAL_EXPIRED`.
2. Новые order events из внешних каналов перестают поступать через runtime sync.
3. История уже импортированных заказов остается доступной в read-only режиме.
4. Новые reserve/release/deduct side-effects из paused integration не создаются.

## 5. Зависимости и интеграции

- Sync (источник order events)
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)
- Marketplace Accounts (runtime availability account)
- Inventory (reserve/release/deduct)
- Catalog (match SKU)
- Warehouses (warehouse scope для FBS order effects)
- Audit

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/orders` | User | Список заказов с фильтрами |
| `GET` | `/api/v1/orders/:orderId` | User | Детали заказа |
| `GET` | `/api/v1/orders/:orderId/timeline` | User | Таймлайн событий заказа |
| `POST` | `/api/v1/orders/:orderId/reprocess` | Owner/Admin | Безопасная повторная обработка order side-effects |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/orders?marketplace=WB&fulfillmentMode=FBS&status=reserved&page=1&limit=20' \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "items": [
    {
      "id": "ord_...",
      "marketplaceOrderId": "WB12345",
      "marketplace": "WB",
      "fulfillmentMode": "FBS",
      "externalStatus": "new",
      "internalStatus": "reserved",
      "affectsStock": true
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

### Frontend поведение

- Текущее состояние: маршрут `/app/orders` переписан под доменный `/api/orders` (TASK_ORDERS_6) — список с 5 фильтрами + KPI tiles + drawer с timeline и кнопкой reprocess; legacy `/sync/orders/poll` и axios-вызовы во внешний API из UI удалены.
- Целевое состояние: нужны детальная карточка, timeline, фильтры по состояниям и объяснение side effects на остатки. _Реализовано в TASK_ORDERS_6._
- UX-правило: пользователь должен видеть внутренний статус заказа, а не только внешний marketplace status.
- UI должен явно показывать, влияет ли заказ на stock и применился ли side-effect успешно.
- В MVP для FBS operational flow достаточно статусов `RESERVED / CANCELLED / FULFILLED`; промежуточные `PACKED / SHIPPED` не выводятся как отдельные внутренние статусы.
- При `TRIAL_EXPIRED` / `SUSPENDED` / `CLOSED` список заказов остается доступным, но пользователь не должен ожидать поступления новых заказов из внешнего API до снятия паузы.

## 8. Модель данных (PostgreSQL)

### `orders`
- `id UUID PK`, `tenant_id UUID`
- `marketplace ENUM(wb, ozon, yandex_market)`
- `marketplace_account_id UUID`
- `sync_run_id UUID NULL`
- `marketplace_order_id VARCHAR(128) NOT NULL`
- `fulfillment_mode ENUM(fbs, fbo)`
- `external_status VARCHAR(128)`
- `internal_status ENUM(imported, reserved, cancelled, fulfilled, display_only_fbo, unresolved)`
- `affects_stock BOOLEAN`
- `stock_effect_status ENUM(not_required, pending, applied, blocked, failed) NOT NULL DEFAULT 'not_required'`
- `warehouse_id UUID NULL`
- `order_created_at TIMESTAMPTZ`, `processed_at TIMESTAMPTZ`
- `UNIQUE(tenant_id, marketplace, marketplace_order_id)`

### `order_items`
- `id UUID PK`, `order_id UUID FK`
- `product_id UUID NULL`, `sku VARCHAR(128)`, `name VARCHAR(255)`
- `match_status ENUM(matched, unmatched) NOT NULL DEFAULT 'unmatched'`
- `warehouse_id UUID NULL`
- `quantity INT NOT NULL`, `price NUMERIC(12,2) NULL`

### `order_events`
- `id UUID PK`, `tenant_id UUID`, `order_id UUID`
- `marketplace_account_id UUID`
- `external_event_id VARCHAR(128) NOT NULL`
- `event_type ENUM(received, status_changed, reserved, reserve_released, deducted, return_logged, duplicate_ignored, out_of_order_ignored, stock_effect_failed)`
- `payload JSONB`, `created_at`
- `UNIQUE(tenant_id, marketplace_account_id, external_event_id)`

## 9. Сценарии и алгоритмы (step-by-step)

1. Внешнее событие order -> проверить preconditions: tenant/account runtime должен разрешать ingestion из внешнего канала.
2. Найти/создать `orders` по уникальному ключу.
3. Если дубль события по `external_event_id` — записать `duplicate_ignored`, бизнес-эффект не повторять.
4. Если событие старее уже обработанного состояния — записать `out_of_order_ignored`, состояние назад не откатывать.
5. FBS новый заказ -> `internal_status=reserved`, вызвать `inventory.reserve(...)` со стабильным `source_event_id`.
6. FBS cancelled -> `inventory.release(...)`.
7. FBS fulfilled -> `inventory.deduct(...)`.
8. Если SKU не сопоставлен или warehouse scope не определен, order сохраняется с `stock_effect_status=pending|failed`, но side-effect не выполняется молча.
9. FBO orders храним и показываем, но `affects_stock=false`, `stock_effect_status=not_required`.
10. Return events в MVP только логируются и не создают automatic restock.

## 10. Валидации и ошибки

- Запрет ручного редактирования статусов на MVP.
- Если SKU не сопоставлен — заказ сохраняется, item помечается `unmatched`.
- Прямой polling заказов из orders API в MVP запрещен: импорт выполняется только через `sync`.
- `reprocess` не должен обращаться во внешний API; он повторно прогоняет только внутреннюю обработку уже сохраненного order event.
- При `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` новые внешние order events не принимаются runtime-контуром.
- Return events не запускают auto-restock в MVP.
- Ошибки:
  - `CONFLICT: ORDER_ALREADY_PROCESSED`
  - `NOT_FOUND: ORDER_NOT_FOUND`
  - `FORBIDDEN: ORDER_INGEST_BLOCKED_BY_TENANT_STATE`
  - `CONFLICT: ORDER_EVENT_OUT_OF_ORDER`
  - `INTERNAL_ERROR: ORDER_EFFECT_APPLY_FAILED`

## 11. Чеклист реализации

- [x] Таблицы orders/items/events. _(TASK_ORDERS_1 — миграция `20260426130000_orders_data_model`)_
- [x] Idempotent ingestion use-case. _(TASK_ORDERS_2 — `OrdersIngestionService` + dual-write из `sync.service`)_
- [x] Маппинг external->internal статусов. _(TASK_ORDERS_3 — `OrderStatusMapperService` + state machine guard в ingestion)_
- [x] Связка с inventory service. _(TASK_ORDERS_4 — `OrderInventoryEffectsService`: reserve/release/deduct/logReturn по FBS transitions, FBO display-only, scope guard §14)_
- [x] API list/details/timeline. _(TASK_ORDERS_5 — `OrdersController` + `OrdersReadService` + safe reprocess Owner/Admin)_

## 12. Критерии готовности (DoD)

- Повторное событие не дублирует reserve/deduct.
- FBS/FBO обрабатываются по разным правилам.
- История событий заказа полностью трассируема.
- Источник order event и связанный `sync_run` восстанавливаются без обращения к сырым логам.
- FBS inventory-critical flow покрывается статусами `RESERVED / CANCELLED / FULFILLED` без дополнительных промежуточных состояний.

## 13. State machine заказа

### Внутренние статусы
- `IMPORTED`
- `RESERVED`
- `CANCELLED`
- `FULFILLED`
- `DISPLAY_ONLY_FBO`
- `UNRESOLVED`

### Основные переходы
- `IMPORTED -> RESERVED`
- `RESERVED -> CANCELLED`
- `RESERVED -> FULFILLED`
- `IMPORTED -> DISPLAY_ONLY_FBO`
- `IMPORTED -> UNRESOLVED`
- `UNRESOLVED -> RESERVED`

### MVP правило по критичным статусам
- Для FBS в MVP business-critical считаются только `RESERVED`, `CANCELLED`, `FULFILLED`.
- Внешние промежуточные статусы маркетплейсов (`PACKED`, `SHIPPED` и аналоги) сохраняются в `external_status`, но не создают отдельный внутренний lifecycle.

## 14. Правила работы с order items

- Один заказ может содержать несколько строк `order_items`.
- Матчинг товара выполняется по SKU / external mapping.
- Если SKU не найден, item сохраняется в заказе, но не участвует в stock-effect, пока не будет resolved.
- Warehouse scope для FBS item должен быть определен до stock-effect; без него заказ не должен silently резервировать остатки "в никуда".

## 15. Async и события

- `order_received`
- `order_deduplicated`
- `order_status_normalized`
- `order_out_of_order_ignored`
- `order_reserved`
- `order_reserve_released`
- `order_fulfilled`
- `order_return_logged`
- `order_stock_effect_failed`

### Что выполняется в фоне
- polling/import orders
- применение stock-effect
- повторная обработка временно неуспешных order events
- логирование return events без auto-restock

## 16. Тестовая матрица

- Новый FBS order.
- Новый FBO order.
- Duplicate event того же заказа.
- Out-of-order event после более нового статуса.
- Cancel order после reserve.
- Fulfill order после reserve.
- Return event без автопополнения stock.
- Unmatched SKU в order item.
- FBS order без warehouse scope не применяет stock-effect.
- `TRIAL_EXPIRED` блокирует новые order side-effects из внешнего канала.
- Внешний `PACKED/SHIPPED` не создает новый внутренний inventory-critical статус.

## 17. Фазы внедрения

1. `orders`, `order_items`, `order_events`.
2. Ingestion + idempotency layer.
3. Internal status mapping.
4. Inventory side-effects.
5. Timeline/details UI and API.

## 18. Нефункциональные требования и SLA

- Order ingestion должен быть идемпотентным и устойчивым к duplicate/out-of-order delivery.
- Read API списка заказов должен поддерживать пагинацию и целевой `p95 < 500 мс` на стандартных фильтрах.
- State transitions и inventory side-effects должны быть атомарно связаны или компенсируемы.
- История статусов заказа должна сохраняться без потери provenance внешнего события.
- При paused integration orders module не должен создавать impression, что данные "живые"; UX и ingestion policy обязаны быть согласованы.

## 19. Observability, логи и алерты

- Метрики: `orders_ingested`, `duplicate_order_events`, `status_mapping_failures`, `unmatched_sku_orders`, `order_side_effect_failures`.
- Логи: ingestion result, mapping decisions, skipped/ignored events, inventory effect correlation ids, `external_event_id`, `sync_run_id`.
- Алерты: рост duplicate events, массовые unmatched SKU, repeated side-effect failures, stuck pending statuses, рост out-of-order ignored events.
- Dashboards: order ingestion board, status distribution, unmatched backlog, duplicate/out-of-order monitor.

## 20. Риски реализации и архитектурные замечания

- Ключевое решение: внутренний статус должен быть отдельной моделью, а не копией внешнего marketplace enum.
- Если side-effects inventory будут вызываться вне контролируемой orchestration-точки, быстро появятся двойные резервы и гонки.
- Нужно заранее определить политику, какие заказы влияют на stock и на каком этапе.
- Исторические order events не должны silently overwrite более новые состояния без version/ordering rules.
- Если orders API начнет сам запускать внешний polling параллельно `sync`, быстро появятся двойные ingestion path и трудноуловимые дубли.
- Автоматический restock по return без надежного подтвержденного сценария возврата даст ложное увеличение остатков.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю orders больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены tenant/account guards, provenance order events, warehouse scope и открытые решения по critical statuses/returns policy | Codex |
| 2026-04-18 | Подтверждены MVP-critical FBS статусы и disabled auto-restock по return events | Codex |
| 2026-04-26 | TASK_ORDERS_1: data model `Order/OrderItem/OrderEvent` + 5 enum-ов, DB-level idempotency через `UNIQUE(tenantId, marketplaceAccountId, externalEventId)`, provenance через `marketplaceAccountId`/`syncRunId`. Legacy `MarketplaceOrder` сохранён для обратной совместимости sync.service. | Anvar |
| 2026-04-26 | TASK_ORDERS_2: `OrdersIngestionService` (idempotent ingestion + duplicate/out-of-order detection + preflight policy guard через `SyncPreflightService`). Dual-write встроен в `processWbOrders/processOzonOrders`. Прямой polling из orders API запрещён структурно — модуль не имеет controller'а. | Anvar |
| 2026-04-26 | TASK_ORDERS_3: `OrderStatusMapperService` с WB/Ozon dictionaries и state machine guard. Терминальные статусы защищены от silent overwrite, INTERMEDIATE (PACKED/SHIPPED/unknown) не меняют lifecycle. Семантические OrderEvent (RESERVED/RESERVE_RELEASED/DEDUCTED) пишутся при transition — источник для inventory side-effects в TASK_ORDERS_4. | Anvar |
| 2026-04-26 | TASK_ORDERS_4: `OrderInventoryEffectsService` с маппингом FBS transitions → `inventory.reserve/release/deduct/logReturn`, стабильный `sourceEventId=order:<id>:<effect>`. Scope guard §14 (UNRESOLVED_SCOPE → FAILED без silent reserve). FBO/return policy: display-only + audit без auto-restock. Inventory call вынесен ЗА транзакцию ingestion'а. | Anvar |
| 2026-04-26 | TASK_ORDERS_5: REST API `/api/v1/orders` (list/detail/timeline + reprocess). `OrdersReadService` с фильтрами (marketplace/fulfillmentMode/internalStatus/stockEffectStatus). `OrdersReprocessService` с role gating Owner/Admin, preflight policy guard, idempotent re-apply через тот же sourceEventId. Никаких внешних API-вызовов из orders REST-слоя. | Anvar |
| 2026-04-26 | TASK_ORDERS_6: фронтенд `/app/orders` переписан под доменный `/api/orders`. Фильтры по 4 осям, KPI tiles, drawer с stock-effect объяснениями + items + timeline по 9 типам OrderEvent + кнопка reprocess. Paused integration banner для TRIAL_EXPIRED/SUSPENDED/CLOSED. Удалены legacy `/sync/orders/poll` и прямой fetch деталей с маркетплейсов из UI. | Anvar |
| 2026-04-26 | TASK_ORDERS_7: 4 unit-spec'а (status-mapper / ingestion / inventory-effects / metrics) — 48 проходящих тестов, покрывают всю §16 матрицу. `OrdersMetricsRegistry` с 8 метриками §19 (ingested/duplicate/out_of_order/status_mapping_failures/unmatched_sku_orders/side_effect_failures/blocked_by_tenant/processing_latency_ms p50/p95). Metrics инструментированы в `OrdersIngestionService.ingest()` через observeAndReturn-обёртку. | Anvar |
