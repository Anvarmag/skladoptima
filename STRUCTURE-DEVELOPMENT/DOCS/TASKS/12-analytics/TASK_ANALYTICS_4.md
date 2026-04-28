# TASK_ANALYTICS_4 — Recommendations, Status API и Export

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_ANALYTICS_1`
  - `TASK_ANALYTICS_2`
  - `TASK_ANALYTICS_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/analytics/recommendations`, `GET /api/v1/analytics/status`, `GET /api/v1/analytics/export`;
  - оставить recommendations в MVP только `rule-based read-only`;
  - не внедрять пользовательский workflow `dismiss/applied`;
  - формировать explainable recommendations с `rule_key`, `reason_code`, `priority`;
  - подготовить export без нарушения tenant isolation и RBAC.
- Критерий закрытия:
  - recommendations остаются аналитическим, а не task-management слоем;
  - status API объясняет freshness/completeness/rebuild state;
  - export работает на готовых витринах, а не на тяжелых live queries.

**Что сделано**

Закрыт цикл analytics MVP — recommendations, status, export. Три новых сервиса + 4 новых endpoints + 17 unit-тестов. Legacy on-the-fly recommendations перенесён под `/analytics/recommendations/legacy` (frontend ещё на нём; переключение в TASK_ANALYTICS_6).

### 1. [analytics-recommendations.service.ts](apps/api/src/modules/analytics/analytics-recommendations.service.ts) — rule engine + read

**§15 контракт (rule-based read-only):**
- workflow `dismiss / applied` со стороны пользователя НЕ внедряется;
- `status` выставляет ТОЛЬКО engine: `ACTIVE` при срабатывании, `DISMISSED` + `resolvedAt` при автоматическом устаревании сигнала.

**§20 explainability:** каждый сигнал — `(ruleKey, reasonCode, priority, payload, formulaVersion)`. Все строки идут через константы из `analytics.constants.ts`, никаких magic strings.

**Идемпотентность (§15):** UPSERT по UNIQUE`(tenantId, productId, ruleKey)`. Повторный refresh обновляет существующий сигнал, не плодит дубли.

**Реализованные правила (MVP):**

| Rule key | Reason code | Priority | Условие |
|---|---|---|---|
| `low_stock_high_demand` | `stock_below_7_days` | HIGH | `daysRemaining < 7` (velocity по 30-дневному окну) |
| `low_stock_high_demand` | `stock_below_14_days` | MEDIUM | `7 <= daysRemaining < 14` |
| `low_rating` | `rating_below_4` | MEDIUM | `0 < product.rating < 4` |
| `stale_analytics_source` | `source_stale_over_24h` | MEDIUM | `last MarketplaceOrder.marketplaceCreatedAt > 48h ago`, tenant-wide (`productId=null`) |

**Lifecycle сигнала:** новый → `ACTIVE` (upsert); существующий не появляется в кандидатах → `DISMISSED` + `resolvedAt = asOf` (engine-driven). UI читает только `ACTIVE`.

**Stock считается так:** для каждого product суммируем `available` по складам (`StockBalance`); если `available` нулевой/отрицательный — fallback на `max(0, onHand - reserved)`. Это совместимо с inventory pipeline TASK_INVENTORY_*.

**Velocity:** `qtyBySku / 30` за последние 30 дней (`MarketplaceOrder.groupBy by productSku`). Один запрос на tenant — не N+1.

### 2. [analytics-status.service.ts](apps/api/src/modules/analytics/analytics-status.service.ts) — freshness/completeness/rebuild

`GET /analytics/status` возвращает в одном вызове:

```ts
{
    formulaVersion,
    sources: { orders: { lastEventAt, isStale, ageHours } },
    daily: { rowsCount, latestDate, oldestDate, statusBreakdown: {READY, STALE, INCOMPLETE, FAILED} },
    abc: { snapshotsCount, latestGeneratedAt, latestPeriod },
    recommendations: { activeCount, dismissedCount, byPriority: {HIGH, MEDIUM, LOW}, latestRefreshAt }
}
```

- `Promise.all` — 7 параллельных запросов;
- НЕ инициирует rebuild и НЕ дёргает marketplace API;
- доступен и при paused tenant — read-only остаётся всегда (§4 сценарий 4).

### 3. [analytics-export.service.ts](apps/api/src/modules/analytics/analytics-export.service.ts) — CSV/JSON export

**§6 + §18 контракт:**
- читает ТОЛЬКО готовые витрины (`AnalyticsMaterializedDaily`, `AnalyticsAbcSnapshot`);
- никаких live queries в OLTP;
- tenant isolation — каждое чтение фильтруется по `tenantId`;
- RBAC — Owner/Admin (gate в controller'е).

**MVP-набор экспортов:**

| Target | Формат | Что отдаёт |
|---|---|---|
| `daily` | CSV | header + rows: `date, revenue_gross, revenue_net, orders_count, units_sold, returns_count, avg_check, wb_revenue_net, wb_orders_count, ozon_revenue_net, ozon_orders_count, snapshot_status` |
| `daily` | JSON | structured `{formulaVersion, period, rows[]}` с per-marketplace breakdown |
| `abc` | CSV | header + rows: `rank, sku, product_id, metric_value, share_pct, cumulative_share, group` |
| `abc` | JSON | `{formulaVersion, metric, period, snapshotStatus, generatedAt, items[]}` |

ABC export → 404 если snapshot за период/metric/formulaVersion отсутствует — пользователь должен сначала вызвать `POST /analytics/abc/rebuild`. Это сознательно: §6 контракт — export на готовых витринах.

CSV escape: ячейки с `,` `"` `\n` оборачиваются в кавычки + удваиваются `"`.

Drill-down per-SKU и recommendations не экспортируются в MVP (§20 риск превращения в data dump).

### 4. DTO [dto/analytics-period.dto.ts](apps/api/src/modules/analytics/dto/analytics-period.dto.ts) — расширены

`ExportQueryDto` — `from / to / target ('daily' | 'abc') / format ('csv' | 'json')? / metric?`.

### 5. [analytics.controller.ts](apps/api/src/modules/analytics/analytics.controller.ts) — обновлён

```
GET   /analytics/recommendations?priority=&limit=     # ACTIVE only, sorted HIGH→MEDIUM→LOW
POST  /analytics/recommendations/refresh              # Owner/Admin
GET   /analytics/status                               # freshness/completeness/rebuild
GET   /analytics/export?target=&format=&from=&to=&metric=     # Owner/Admin, CSV/JSON
GET   /analytics/recommendations/legacy               # текущий on-the-fly (для обратной совместимости)
```

`GET /export` использует `@Res()` чтобы выставить `Content-Type` и `Content-Disposition: attachment` — браузер сразу скачивает файл.

### 6. [analytics.module.ts](apps/api/src/modules/analytics/analytics.module.ts) — обновлён

Добавлены providers/exports: `AnalyticsRecommendationsService`, `AnalyticsStatusService`, `AnalyticsExportService`.

### 7. Spec покрытие — 17 тестов

[analytics-recommendations.spec.ts](apps/api/src/modules/analytics/analytics-recommendations.spec.ts) — **10 тестов**:

| # | Что проверяет |
|---|---|
| 1 | пустой tenant → 0 кандидатов, нет upsert |
| 2 | LOW_STOCK <7 дней → HIGH + reasonCode `stock_below_7_days` |
| 3 | LOW_STOCK 7..14 дней → MEDIUM + reasonCode `stock_below_14_days` |
| 4 | LOW_STOCK не срабатывает при стоке > 14 дней |
| 5 | LOW_RATING при `rating<4` → MEDIUM |
| 6 | STALE_ANALYTICS_SOURCE при `age>48h` → tenant-wide MEDIUM |
| 7 | повторный refresh устаревший сигнал → DISMISSED + resolvedAt |
| 8 | идемпотентность: тот же сигнал → upsert (не дубль) |
| 9 | list возвращает только ACTIVE с product name резолвом |
| 10 | пустой list → [] |

[analytics-status.spec.ts](apps/api/src/modules/analytics/analytics-status.spec.ts) — **2 теста**:

| # | Что проверяет |
|---|---|
| 1 | пустой tenant → null/0 значения, без exception |
| 2 | агрегирует все витрины + считает stale флаг по 48h окну |

[analytics-export.spec.ts](apps/api/src/modules/analytics/analytics-export.spec.ts) — **5 тестов**:

| # | Что проверяет |
|---|---|
| 1 | daily CSV: header + tenant isolation в where |
| 2 | daily JSON: structured shape |
| 3 | abc snapshot отсутствует → 404 |
| 4 | abc CSV: items из payload в плоском виде |
| 5 | period > 366 дней → 400 |

### 8. Проверки

- `npx jest --testPathPatterns="analytics"` → **53/53 passed, 7 suites passed**:
  - calculator(abc) 8, abc 10, aggregator 6, read 12, recommendations 10, status 2, export 5.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing).

### 9. DoD сверка

- ✅ **Recommendations остаются аналитическим, а не task-management слоем**: `status` выставляется только engine'ом, `dismiss/applied` НЕ exposed в API, UI получает read-only список explainable hints.
- ✅ **Status API объясняет freshness/completeness/rebuild state**: `sources.orders.{lastEventAt, isStale, ageHours}`, `daily.statusBreakdown`, `abc.latestGeneratedAt`, `recommendations.latestRefreshAt` — всё в одном вызове.
- ✅ **Export работает на готовых витринах, а не на тяжелых live queries**: `daily` читает `AnalyticsMaterializedDaily`, `abc` — `AnalyticsAbcSnapshot`; ABC без существующего snapshot → 404 (нельзя инициировать rebuild через export).

### 10. Что НЕ сделано (намеренно)

- **`AnalyticsPolicyService` + tenant-state guard** — TASK_ANALYTICS_5 (сейчас гард приходит «бесплатно» от `TenantWriteGuard`).
- **Frontend rewrite** — TASK_ANALYTICS_6.
- **Метрики/observability + nightly cron job для recommendation refresh** — TASK_ANALYTICS_7.
- **Drill-down/recommendations export** — за пределами §6 MVP.
- **Удаление legacy `analytics.service.ts`** — после переключения frontend.
