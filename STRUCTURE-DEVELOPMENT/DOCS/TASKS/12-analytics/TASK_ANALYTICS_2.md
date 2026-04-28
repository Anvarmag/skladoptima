# TASK_ANALYTICS_2 — Dashboard KPI, Revenue Dynamics и Read APIs

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_ANALYTICS_1`
- Что нужно сделать:
  - реализовать `GET /api/v1/analytics/dashboard`, `GET /api/v1/analytics/revenue-dynamics`, `GET /api/v1/analytics/products/top`, `GET /api/v1/analytics/products/:productId`;
  - ограничить первый dashboard MVP набором KPI: `revenue_net`, `orders_count`, `units_sold`, `avg_check`, `returns_count`, `top marketplace share`;
  - построить read APIs на materialized/read-model слое без тяжелых realtime joins;
  - реализовать drill-down по SKU на согласованных источниках;
  - ограничить online period range и ввести валидации по размеру окна.
- Критерий закрытия:
  - dashboard и top/drill-down APIs быстрые и детерминированные;
  - первый экран не перегружен лишними KPI;
  - backend и frontend опираются на один и тот же KPI contract.

**Что сделано**

Заложен read-слой analytics + daily aggregation pipeline. Все четыре read-эндпоинта выведены на `AnalyticsMaterializedDaily` (без тяжёлых realtime join'ов в горячем пути). Legacy `analytics.service.ts` сохранён и доступен под `/analytics/recommendations`, `/analytics/geo`, `/analytics/revenue-dynamics/legacy` — frontend пока ходит туда, переключение в TASK_ANALYTICS_6.

### 1. [analytics-aggregator.service.ts](apps/api/src/modules/analytics/analytics-aggregator.service.ts) — daily layer rebuild

Orchestrator для `AnalyticsMaterializedDaily`. Используется:
- on-demand эндпоинтом `POST /analytics/daily/rebuild` (Owner/Admin);
- (в будущем) nightly job'ом — TASK_ANALYTICS_5/7.

Контракт:
- читает только нормализованные `MarketplaceOrder` по tenant'у — НЕ дёргает marketplace API;
- идемпотентность через `prisma.analyticsMaterializedDaily.upsert` по `(tenantId, date)` (UNIQUE из TASK_ANALYTICS_1);
- сеет нулевые строки на дни без заказов — revenue dynamics рисует ось X непрерывно;
- per-day / per-marketplace breakdown пишется в `byMarketplace JSONB` сразу — UI не считает на лету;
- возвраты (`status` содержит `return / cancel / возврат`) НЕ увеличивают `revenueGross`, но уменьшают `revenueNet` и инкрементируют `returnsCount`;
- считает `sourceFreshness.orders` — самый свежий `marketplaceCreatedAt` против окна `ANALYTICS_STALE_SOURCE_WINDOW_HOURS=48`. Если STALE — поднимает `snapshotStatus=STALE` на всех строках периода через `updateMany`;
- валидация: `to >= from` и `days <= ANALYTICS_MAX_PERIOD_DAYS=366`.

### 2. [analytics-read.service.ts](apps/api/src/modules/analytics/analytics-read.service.ts) — 4 read API

| Метод | Источник | Что возвращает |
|---|---|---|
| `getDashboard(tenantId, period)` | `AnalyticsMaterializedDaily` (1 запрос) | KPI cards `{revenueNet, ordersCount, unitsSold, avgCheck, returnsCount, topMarketplaceShare}` + meta `{period, formulaVersion, snapshotStatus, sourceFreshness}` |
| `getRevenueDynamics(tenantId, period)` | `AnalyticsMaterializedDaily` (1 запрос) | `series[]` с `{date, revenueNet, ordersCount, byMarketplace}` |
| `getTopProducts(tenantId, period, limit, marketplace?)` | `MarketplaceOrder.groupBy` (1 запрос) + `Product.findMany` (1 запрос) | `items[]` с `{productId, sku, name, revenueNet, unitsSold, ordersCount}` |
| `getProductDrillDown(tenantId, productId, period)` | `Product.findFirst` + `MarketplaceOrder.findMany` (limit 200) | KPI + `recentOrders[30]` |

Контракт:
- **первый dashboard ограничен MVP §13 KPI** — `revenueGross` НЕ возвращается в `getDashboard.kpis` (доступен в drill-down при необходимости);
- snapshot пуст → `snapshotStatus='EMPTY'`, нулевые KPI, **без exception** (§16 «dashboard на пустом tenant»);
- агрегатный `snapshotStatus` собирается из дневных строк по приоритету `FAILED > STALE > INCOMPLETE > READY`;
- top marketplace share = `(top.revenueNet / total.revenueNet) * 100`, `null` при пустом периоде;
- drill-down по неизвестному `productId` или из чужого tenant → `404 PRODUCT_ANALYTICS_NOT_FOUND`;
- все методы валидируют период через `_validatePeriod` (`400 ANALYTICS_PERIOD_INVALID` / `400 ANALYTICS_PERIOD_TOO_LARGE`).

### 3. DTO [dto/analytics-period.dto.ts](apps/api/src/modules/analytics/dto/analytics-period.dto.ts)

`AnalyticsPeriodDto` (`from / to` ISO date string), `TopProductsQueryDto` (`limit 1..100`, `marketplace WB|OZON`), `RebuildDailyDto`. Длина окна валидируется в сервисе — единый источник истины в `analytics.constants`.

### 4. [analytics.controller.ts](apps/api/src/modules/analytics/analytics.controller.ts) — обновлён

Новые endpoints (TASK_ANALYTICS_2):

```
GET   /analytics/dashboard?from=&to=
GET   /analytics/revenue-dynamics?from=&to=
GET   /analytics/products/top?from=&to=&limit=&marketplace=
GET   /analytics/products/:productId?from=&to=
POST  /analytics/daily/rebuild         body: { from, to }   Owner/Admin
```

Legacy сохранены:
```
GET   /analytics/recommendations              # legacy on-the-fly
GET   /analytics/geo                          # legacy on-the-fly
GET   /analytics/revenue-dynamics/legacy      # старый 14-дневный realtime
```

Read доступны при `RequireActiveTenantGuard` (read-only остаётся в paused tenant'ах). Write `POST /daily/rebuild` использует `TenantWriteGuard` + role check (Owner/Admin) внутри controller'а через membership lookup — как и в `FinanceController.rebuildSnapshot`.

> Гард на `TRIAL_EXPIRED / SUSPENDED / CLOSED` приходит «бесплатно» от `TenantWriteGuard`. Централизованный `AnalyticsPolicyService` (по образцу `FinancePolicyService`) — TASK_ANALYTICS_5.

### 5. [analytics.module.ts](apps/api/src/modules/analytics/analytics.module.ts) — обновлён

Добавлены providers + exports `AnalyticsReadService`, `AnalyticsAggregatorService`. Legacy `AnalyticsService` остаётся.

### 6. Spec покрытие — 18 тестов

[analytics-read.spec.ts](apps/api/src/modules/analytics/analytics-read.spec.ts) — **12 тестов**:

| # | Что проверяет |
|---|---|
| 1 | dashboard на пустом tenant → `snapshotStatus=EMPTY`, нулевые KPI, без exception |
| 2 | dashboard агрегирует KPI и считает top marketplace share |
| 3 | агрегатный `snapshotStatus=STALE` если хотя бы один день STALE |
| 4 | dashboard НЕ возвращает `revenueGross` (§13 MVP контракт) |
| 5 | revenue-dynamics возвращает series в ISO date |
| 6 | top products сортирует по revenue, подтягивает product name |
| 7 | top limit clamp до 100 |
| 8 | top marketplace фильтр прокидывается в where |
| 9 | drill-down по неизвестному product → 404 |
| 10 | drill-down: возвраты вычитают revenue, не считаются заказом |
| 11 | period.to < from → 400 |
| 12 | period > 366 дней → 400 |

[analytics-aggregator.spec.ts](apps/api/src/modules/analytics/analytics-aggregator.spec.ts) — **6 тестов**:

| # | Что проверяет |
|---|---|
| 1 | создаёт строки для всех дней включая дни без заказов |
| 2 | возврат не увеличивает gross, уменьшает net, не считается заказом |
| 3 | per-marketplace breakdown пишется в byMarketplace |
| 4 | STALE источник → snapshotStatus=STALE и `updateMany` для прокидывания |
| 5 | period.to < from → 400 |
| 6 | period > 366 дней → 400 |

### 7. Проверки

- `npx jest --testPathPatterns="analytics"` → **18/18 passed, 2 suites passed** (analytics-read 12 + analytics-aggregator 6).
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок, все pre-existing (legacy скрипты, `import.service*`, `sync-runs.regression.spec`, `team-scheduler`).

### 8. DoD сверка

- ✅ **Dashboard и top/drill-down APIs быстрые и детерминированные**: dashboard и revenue-dynamics — 1 запрос к `AnalyticsMaterializedDaily` с `(tenantId, date)` индексом; top — `groupBy` + `findMany(in:[skus])`; drill-down — 2 запроса с `take:200`. Всё детерминировано в рамках одного формулы/period.
- ✅ **Первый экран не перегружен лишними KPI**: `getDashboard.kpis` ограничен ровно §13 MVP набором (revenue_net, orders_count, units_sold, avg_check, returns_count, top_marketplace_share). `revenueGross` отсутствует в выдаче — покрыто тестом.
- ✅ **Backend и frontend опираются на один и тот же KPI contract**: типы `DashboardResponse / RevenueDynamicsResponse / TopProductRow / ProductDrillDown` экспортированы из `analytics-read.service.ts` — frontend (TASK_ANALYTICS_6) импортирует их же.

### 9. Что НЕ сделано (намеренно — за пределами scope)

- **ABC engine + `/analytics/abc`** — TASK_ANALYTICS_3.
- **Recommendations + `/analytics/recommendations` (новый), `/analytics/status`, `/analytics/export`** — TASK_ANALYTICS_4.
- **`AnalyticsPolicyService` + freshness/incomplete политика** — TASK_ANALYTICS_5.
- **Frontend rewrite** — TASK_ANALYTICS_6.
- **Nightly cron job** — будет в TASK_ANALYTICS_5 или 7 (после tenant guard'а).
- **Метрики/observability** — TASK_ANALYTICS_7.
- **Удаление legacy `analytics.service.ts`** — после переключения frontend.
