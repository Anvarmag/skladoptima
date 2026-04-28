# TASK_ORDERS_5 — API List/Details/Timeline и Safe Reprocess

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_ORDERS_1`
  - `TASK_ORDERS_2`
  - `TASK_ORDERS_3`
  - `TASK_ORDERS_4`
- Что нужно сделать:
  - реализовать `GET /api/v1/orders`, `GET /api/v1/orders/:orderId`, `GET /api/v1/orders/:orderId/timeline`;
  - реализовать `POST /api/v1/orders/:orderId/reprocess`;
  - в `reprocess` повторно прогонять только внутреннюю обработку уже сохраненного события;
  - не допускать обращение `reprocess` во внешний API;
  - отдать filters по marketplace, fulfillment mode, internal status, stock effect status.
- Критерий закрытия:
  - orders API покрывает operational read scenarios и timeline;
  - safe reprocess не ломает idempotency и не ходит наружу;
  - owner/admin/manager получают только допустимые действия по роли.

**Что сделано**

В orders domain появился REST-слой (раньше модуль не имел controller'а — структурный запрет на orders-side polling из TASK_ORDERS_2 сохраняется: новый controller тоже не делает ни одного `axios`-вызова, только Prisma read и вызовы внутренних сервисов).

### 1. Read service [orders-read.service.ts](apps/api/src/modules/orders/orders-read.service.ts)

Все запросы строго scoped по `tenantId` (изоляция per §3). DTO выходные плоские: `Decimal` сериализуется через `.toString()`, `Date` — через `.toISOString()` — UI получает JSON-friendly типы без Prisma-инстансов.

- **`list(tenantId, query)`** — пагинация (`page`/`limit`) + фильтры из §6/§7:
  - `marketplace` (`MarketplaceType`), `fulfillmentMode` (`OrderFulfillmentMode`), `internalStatus` (`OrderInternalStatus`), `stockEffectStatus` (`OrderStockEffectStatus`), `search` (ILIKE по `marketplaceOrderId`).
  - Сортировка `createdAt desc`. Все типичные комбинации фильтров покрыты индексами из TASK_ORDERS_1: `(tenantId, internalStatus, createdAt)`, `(tenantId, marketplaceAccountId, createdAt)`, `(tenantId, stockEffectStatus, createdAt)` — обеспечивает SLA §18 (p95 < 500мс).
  - Возвращает `{ items: [...header...], meta: { page, limit, total, pages } }`.
- **`detail(tenantId, orderId)`** — header + items (`productId`, `sku`, `name`, `matchStatus`, `warehouseId`, `quantity`, `price`). 404 `ORDER_NOT_FOUND` если заказ не принадлежит tenant'у.
- **`timeline(tenantId, orderId)`** — все `OrderEvent` по заказу, сортировка `createdAt asc`. Сначала проверяется существование заказа, чтобы для чужого заказа возвращался `404 ORDER_NOT_FOUND`, а не пустой timeline. Payload event'ов отдаётся как есть (`Json`), `eventType` — машинный enum (UI рендерит в человекочитаемые лейблы).

### 2. Reprocess service [orders-reprocess.service.ts](apps/api/src/modules/orders/orders-reprocess.service.ts)

Safe-reprocess — единственная write-операция в orders REST-слое. Спроектирован под четыре жёстких ограничения §10 + §6:

1. **Никаких внешних API**. Сервис вообще не импортирует `axios`. Он перезапускает только `OrderInventoryEffectsService.applyTransitionEffect` для уже сохранённого заказа — это §10 правило "повторно прогоняет только внутреннюю обработку уже сохранённого order event".
2. **Role gating Owner/Admin** (§6). Перед любыми side-effects подгружается `Membership` пользователя; `MANAGER`/`STAFF` получают `403 ROLE_FORBIDDEN`. Membership-lookup — потому что role не выставляется в request middleware'ом MVP (см. `ActiveTenantGuard` — role в `req` не пробрасывается). Service-level check выбран сознательно: заводить новый `RolesGuard` ради единственного endpoint'а избыточно.
3. **Preflight policy guard**. `SyncPreflightService.runPreflight(tenantId, marketplaceAccountId, {operation:'order_reprocess'})` — paused tenant возвращает `BLOCKED_BY_TENANT` с кодом причины (§4 сценарий 4: paused integration не должна создавать обходных side-effects, даже через ручной reprocess).
4. **Idempotency**. Каждый вызов inventory layer'а использует тот же стабильный `sourceEventId = order:<orderId>:<effect>`, что и первичный ingestion. `InventoryEffectLock UNIQUE(tenantId, effectType, sourceEventId)` гарантирует, что повторный reserve не задвоит остаток — inventory вернёт `IGNORED+idempotent`, что в effects-сервисе мапится в `APPLIED`.

#### Возвращаемые статусы

- `APPLIED` — effect успешно (пере)применён; новый `stockEffectStatus`.
- `BLOCKED_BY_TENANT` — preflight отказал; payload содержит `detail` с `SyncBlockedReasonCode`.
- `NOT_APPLICABLE` — для FBO заказов (display-only) или заказов в `IMPORTED/UNRESOLVED/DISPLAY_ONLY_FBO` (нет business-critical статуса для inventory).
- `STILL_FAILED` — items по-прежнему unresolved; `STOCK_EFFECT_FAILED` event с `UNRESOLVED_SCOPE` записан, оператор должен сначала сматчить SKU/warehouse.

#### Audit-след в timeline

Каждый reprocess append'ит `OrderEvent` типа `RECEIVED` (отдельный event-type под reprocess не заводился — это admin-операция, не бизнес-событие):

```json
{
  "reprocess": true,
  "actor": "<userId>",
  "previousStockEffectStatus": "FAILED",
  "newStockEffectStatus": "APPLIED",
  "internalStatus": "RESERVED"
}
```

`externalEventId = order:<orderId>:reprocess:<timestamp>` — UNIQUE-safe.

### 3. Controller [orders.controller.ts](apps/api/src/modules/orders/orders.controller.ts)

```
GET    /api/v1/orders                       — RequireActiveTenantGuard
GET    /api/v1/orders/:orderId              — RequireActiveTenantGuard
GET    /api/v1/orders/:orderId/timeline     — RequireActiveTenantGuard
POST   /api/v1/orders/:orderId/reprocess    — RequireActiveTenantGuard + TenantWriteGuard
```

`TenantWriteGuard` на reprocess отбивает `TRIAL_EXPIRED/SUSPENDED/CLOSED` ещё до сервиса — это та же защита, что используется для всех write-endpoints в MVP (см. marketplace-accounts/inventory controllers). Role gating сделан сервисом (см. п.2 выше).

### 4. DTO [dto/list-orders.query.ts](apps/api/src/modules/orders/dto/list-orders.query.ts)

Использует `class-validator` + `class-transformer` (тот же pattern, что в catalog/inventory DTO). `@Transform` нормализует case enum'ов: `?marketplace=wb` будет принят так же, как `?marketplace=WB`.

### 5. Регистрация в [orders.module.ts](apps/api/src/modules/orders/orders.module.ts) + [app.module.ts](apps/api/src/app.module.ts)

`OrdersModule` теперь явно импортируется в `AppModule` (раньше попадал транзитивно через `SyncModule`). Provides: `OrdersReadService`, `OrdersReprocessService`. Controllers: `[OrdersController]`. Exports не меняются (read/reprocess сервисы — internal, не нужны другим модулям).

### 6. Пример использования (для UI контракта)

```bash
# List with filters
GET /api/v1/orders?marketplace=OZON&internalStatus=RESERVED&page=1&limit=20

# Detail
GET /api/v1/orders/ord_abc123

# Timeline
GET /api/v1/orders/ord_abc123/timeline

# Reprocess (Owner/Admin only)
POST /api/v1/orders/ord_abc123/reprocess
```

### 7. Проверки

- `npx prisma validate` → schema valid (миграций не понадобилось).
- `npx tsc --noEmit -p tsconfig.json` → 0 ошибок в `orders/*`. Общий счётчик 20 — все pre-existing в чужих модулях (`fix-ozon-dates.ts`, `test-fbo*.ts`, `update-pwd.ts`, `catalog/import.service*`, `team-scheduler.service.ts`, `sync-runs.regression.spec.ts`).

### 8. DoD сверка

- ✅ **API покрывает operational read scenarios + timeline**: list с 4 фильтрами + search, detail с items, timeline с полным audit-trail event'ов TASK_ORDERS_2/3/4.
- ✅ **Safe reprocess не ломает idempotency**: переиспользует тот же `sourceEventId` формат, что и первичный ingestion → `InventoryEffectLock UNIQUE` гарантирует no-double-reserve.
- ✅ **Reprocess не ходит наружу**: ни одного импорта `axios` / `fetch` / external HTTP клиента в `orders-reprocess.service.ts`. Только Prisma + локальные сервисы (`SyncPreflightService`, `OrderInventoryEffectsService`).
- ✅ **Role gating Owner/Admin/Manager**: read-эндпоинты доступны любому активному member'у (User role); reprocess проверяет `Membership.role IN (OWNER, ADMIN)` и бьёт `403 ROLE_FORBIDDEN` для остальных.

### 9. Что НЕ сделано (за пределами scope §11)

- **Frontend integration** — UI компоненты `/app/orders` существуют и читают `/sync/orders` (legacy, на `MarketplaceOrder`). Переключение фронта на новый `/api/v1/orders` — отдельный задача из бэклога UI/web.
- **Webhook ingest endpoint** — orders module по-прежнему пассивный, ingestion остаётся через sync-адаптеров. Webhooks это TASK на стороне `09-sync` модуля.
- **Warehouse scope mapper для FBS items** — без него reprocess для большинства FBS заказов будет возвращать `STILL_FAILED` (это корректно по §14, но требует UI для ручного маппинга, который тоже за пределами TASK_ORDERS_5).
