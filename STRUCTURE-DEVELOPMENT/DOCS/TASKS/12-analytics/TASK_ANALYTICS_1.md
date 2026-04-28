# TASK_ANALYTICS_1 — Materialized Daily Layer и Analytics Data Model

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - утверждена системная аналитика `12-analytics`
  - согласованы `10-orders`, `11-finance`
- Что нужно сделать:
  - завести `analytics_materialized_daily`, `analytics_abc_snapshots`, `analytics_recommendations`;
  - закрепить KPI поля daily layer: `revenue_net`, `orders_count`, `units_sold`, `returns_count`, `avg_check`, `by_marketplace`;
  - предусмотреть `formula_version`, `snapshot_status`, `source_freshness`;
  - подготовить хранение explainable recommendation payload с `rule_key`, `reason_code`, `priority`;
  - согласовать модель с orders, catalog, finance и inventory read sources.
- Критерий закрытия:
  - data model покрывает dashboard, ABC и recommendation layer;
  - read-model слой отделен от OLTP и пригоден для быстрых API;
  - freshness/completeness markers выражены явно.

**Что сделано**

Заложен read-model слой analytics domain — 3 новые таблицы + 4 enum + миграция + единые константы версий и rule-keys. Существующий `analytics.service.ts` (текущий MVP) **не тронут** — он продолжает считать on-the-fly из `MarketplaceOrder` и обслуживать frontend; переключение читателей на новые таблицы намеренно отложено в `TASK_ANALYTICS_4`, чтобы не ломать живой UX до появления fast read API + nightly aggregation pipeline.

### 1. Новые enum в [schema.prisma](apps/api/prisma/schema.prisma)

| Enum | Значения | Зачем |
|---|---|---|
| `AnalyticsAbcMetric` | `REVENUE_NET`, `UNITS` | §14 правило MVP — ABC по `REVENUE_NET`, чтобы не смешивать gross с возвратным шумом. `UNITS` зарезервирован под штучный drill-down. |
| `AnalyticsSnapshotStatus` | `READY`, `STALE`, `INCOMPLETE`, `FAILED` | §19 stale-vs-incomplete board: `STALE` — источник перестал обновляться, `INCOMPLETE` — источник свежий, но часть компонентов отсутствует. Оба состояния могут быть одновременно представимы в UI. |
| `AnalyticsRecommendationPriority` | `LOW`, `MEDIUM`, `HIGH` | UI рендерит цветовой бейдж и сортировку. |
| `AnalyticsRecommendationStatus` | `ACTIVE`, `DISMISSED`, `APPLIED` | §15 MVP правило: `DISMISSED/APPLIED` зарезервированы под будущий workflow и пока выставляются только rule engine'ом при автоматическом устаревании сигнала. |

### 2. Таблица `AnalyticsMaterializedDaily` — дневной KPI слой

Одна строка на `(tenant, date)`. Источник для revenue dynamics, dashboard KPI и базы под ABC.

| Поле | Тип | Назначение |
|---|---|---|
| `revenueGross` / `revenueNet` | `DECIMAL(14,2)` | §13 явное разделение gross vs net — dashboard смешивать их не имеет права. |
| `ordersCount`, `unitsSold`, `returnsCount` | `INTEGER` | KPI cards. |
| `avgCheck` | `DECIMAL(12,2)` | Денормализован сознательно: при больших периодах считать его на лету = N делений. |
| `byMarketplace` | `JSONB` | `{"WB": {"revenueNet", "ordersCount", "unitsSold"}, "OZON": {...}}` — per-channel разбивка без отдельной таблицы на каждый маркетплейс. |
| `sourceFreshness` | `JSONB?` | `{"orders": {"lastEventAt", "isStale"}, "finance": {...}}` — UI рисует `fresh / stale / incomplete` бейдж. |
| `formulaVersion` | `VARCHAR(32)` | Меняется при пересмотре формул KPI; старые строки переписываются rebuild'ом, а не молчаливо переинтерпретируются. |
| `snapshotStatus` | enum | `READY / STALE / INCOMPLETE / FAILED`. |

**Индексы:**
- `UNIQUE(tenantId, date)` — §15 идемпотентность daily aggregation: повторный запуск job'а на тот же `(tenant, date)` — upsert.
- `(tenantId, date)` — hot path: revenue dynamics window read.
- `(tenantId, snapshotStatus, date)` — §19 stale-vs-incomplete board.

### 3. Таблица `AnalyticsAbcSnapshot` — ABC за период

| Поле | Тип | Назначение |
|---|---|---|
| `periodFrom`, `periodTo` | `DATE` | Период расчёта. |
| `metric` | enum | `REVENUE_NET` (MVP) / `UNITS`. |
| `formulaVersion` | `VARCHAR(32)` | Совместно с metric и периодом — ключ воспроизводимости (§14 + §20). |
| `snapshotStatus` | enum | `READY / STALE / INCOMPLETE / FAILED`. |
| `payload` | `JSONB` | Массив SKU `{productId, sku, metricValue, sharePct, cumulativeShare, group: "A"|"B"|"C"}`. Денормализован сознательно — snapshot читается целиком при открытии экрана, отдельная таблица per-SKU = оверкилл. |
| `sourceFreshness` | `JSONB?` | Какие источники были «живы» на момент расчёта. |

**Индексы:**
- `UNIQUE(tenantId, periodFrom, periodTo, metric, formulaVersion)` — §15 идемпотентность rebuild + историзация по метрике/версии формулы.
- `(tenantId, periodTo, generatedAt)` — список последних снапшотов tenant'а.
- `(tenantId, snapshotStatus, generatedAt)` — §19 health board.

### 4. Таблица `AnalyticsRecommendation` — explainable rule-based сигналы

| Поле | Тип | Назначение |
|---|---|---|
| `productId` | `TEXT?` | Опционально: рекомендация может быть per-SKU (`LOW_STOCK_HIGH_DEMAND`) или tenant-wide (`STALE_ANALYTICS_SOURCE`). FK SET NULL — soft-delete товара не ломает историю сигналов. |
| `ruleKey` | `VARCHAR(64)` | Идентификатор правила-эвристики (стабилен, см. константы). |
| `reasonCode` | `VARCHAR(64)` | Машинно-читаемое объяснение, ПОЧЕМУ правило сработало. Один `ruleKey` может иметь несколько `reasonCode` (разные пороги). UI рендерит по `reasonCode`. |
| `priority` / `status` | enums | `LOW/MEDIUM/HIGH` + `ACTIVE/DISMISSED/APPLIED`. |
| `message` | `TEXT` | Человекочитаемая копия для UI. |
| `payload` | `JSONB?` | Контекст drill-down: `current_stock`, `daily_velocity`, `days_remaining` и т.п. — UI раскрывает «почему именно это правило». |
| `formulaVersion` | `VARCHAR(32)` | Версионирование набора правил (§20). |

**Индексы:**
- `UNIQUE(tenantId, productId, ruleKey)` — §15 идемпотентность recommendation refresh: один активный сигнал на `(tenant, product, ruleKey)`. Postgres NULLS DISTINCT (default) даёт нам множественные tenant-wide правила без `productId`.
- `(tenantId, status, priority)` — UI «топ активных рекомендаций».
- `(tenantId, productId)` — drill-down по конкретному SKU.

### 5. Миграция [20260428100000_analytics_data_model/migration.sql](apps/api/prisma/migrations/20260428100000_analytics_data_model/migration.sql)

Аддитивная: 4 `CREATE TYPE` + 3 `CREATE TABLE` + FK + индексы. Не трогает legacy `analytics.service.ts`, `MarketplaceOrder`, `Order`, `Product` — продолжают работать как раньше. Сделана по образцу [20260428000000_finance_data_model/migration.sql](apps/api/prisma/migrations/20260428000000_finance_data_model/migration.sql).

### 6. Wiring в существующие модели

- В `Tenant` добавлены back-relations: `analyticsDailyMetrics`, `analyticsAbcSnapshots`, `analyticsRecommendations` — обязательны для prisma client + чистоты query API.
- В `Product` добавлен back-relation `analyticsRecommendations` — нужен для FK SET NULL при soft-delete товара.

### 7. Константы [analytics.constants.ts](apps/api/src/modules/analytics/analytics.constants.ts)

Единое место для всех «explainable» строк:

```ts
ANALYTICS_FORMULA_VERSION = 'mvp-v1'
ABC_GROUP_THRESHOLDS = { A: 0.8, B: 0.95 }   // §14 — A первые 80%, B следующие 15%, C остаток
ANALYTICS_STALE_SOURCE_WINDOW_HOURS = 48     // §18 SLA, совпадает с finance для одинаковой freshness-границы
ANALYTICS_MAX_PERIOD_DAYS = 366              // §10 ограничение online-запроса

ANALYTICS_RULE_KEYS = {
    LOW_STOCK_HIGH_DEMAND, NEGATIVE_MARGIN, LOW_RATING,
    STALE_ANALYTICS_SOURCE, ABC_GROUP_C_LOW_TURNOVER,
}

ANALYTICS_REASON_CODES = {
    STOCK_BELOW_7_DAYS, STOCK_BELOW_14_DAYS,
    PROFIT_NEGATIVE, RATING_BELOW_4,
    SOURCE_STALE_OVER_24H, LOW_TURNOVER_30_DAYS,
}
```

Зачем отдельный файл (а не magic strings в сервисах): §14 + §20 риск «recommendation должна быть explainable и versioned». Если правило закодировано строкой в одном месте, мы рано или поздно расходимся между rule engine, UI рендером и тестами.

### 8. Что НЕ сделано (намеренно — за пределами scope TASK_ANALYTICS_1)

- **Daily aggregation job** — TASK_ANALYTICS_2.
- **ABC snapshot engine + rule engine** — TASK_ANALYTICS_3.
- **Read API `/api/v1/analytics/dashboard|abc|recommendations`** — TASK_ANALYTICS_4 (одновременно с переключением frontend на read-model).
- **Tenant access-state guard для rebuild** — TASK_ANALYTICS_5 (по аналогии с `FinancePolicyService.assertRebuildAllowed`).
- **Frontend перерисовка** — TASK_ANALYTICS_6.
- **Тесты + observability** — TASK_ANALYTICS_7.
- **Удаление legacy `analytics.service.ts`** — НЕ планируется в текущей итерации, будет ребзабракован, когда новый API станет primary.

### 9. Проверки

- `npx prisma generate` → ✓ (`Generated Prisma Client (v5.21.1)`).
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing: `fix-ozon-dates.ts`, `test-fbo*.ts`, `update-pwd.ts`, `import.service*.ts`, `sync-runs.regression.spec.ts`, `team-scheduler.service.ts`). **Новые модели и константы компилируются без ошибок.**

### 10. DoD сверка

- ✅ **Data model покрывает dashboard, ABC и recommendation layer**: `AnalyticsMaterializedDaily` (dashboard + revenue dynamics), `AnalyticsAbcSnapshot` (ABC), `AnalyticsRecommendation` (rule engine).
- ✅ **Read-model слой отделён от OLTP и пригоден для быстрых API**: индексы заточены под hot paths (`(tenantId, date)` для window reads, `(tenantId, status, priority)` для топ рекомендаций); payload в JSONB читается целиком без join'ов.
- ✅ **Freshness/completeness markers выражены явно**: `snapshotStatus` enum с разделёнными `STALE` vs `INCOMPLETE`, `sourceFreshness` JSONB на каждой витрине, `formulaVersion` для воспроизводимости.
