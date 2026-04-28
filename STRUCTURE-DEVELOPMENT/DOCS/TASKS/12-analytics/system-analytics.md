# Аналитика продаж (ABC) — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `12-analytics`

## 1. Назначение модуля

Модуль предоставляет dashboard продаж и ассортимента: выручка, заказы, средний чек, динамика по времени, ABC-группы, top SKU, рекомендационный слой.

### Текущее состояние (as-is)

- в backend уже есть модуль `analytics` с endpoint для recommendations, geo и revenue dynamics;
- во frontend уже существует страница `Analytics`, которая закрывает часть аналитического контура;
- при этом полноценные ABC, dashboards, export и materialized read-model витрины пока описаны шире, чем текущая реализация.

### Целевое состояние (to-be)

- analytics должен стать слоем бизнес-витрин по ассортименту, выручке, ABC и рекомендациям;
- все тяжелые расчеты должны читаться из агрегатов и snapshot/read-model, а не напрямую из OLTP;
- analytics должен уважать freshness и runtime-политику источников: при `TRIAL_EXPIRED / SUSPENDED / CLOSED` отчеты остаются доступными, но rebuild и приток новых внешних данных не должны происходить обходным путем;
- аналитика должна быть детерминированной, объяснимой и пригодной для регулярных продуктовых решений.


## 2. Функциональный контур и границы

### Что входит в модуль
- продуктовые read-model для sales overview и ABC;
- агрегации по периодам, каналам, SKU и категориям;
- recommendation layer на rule-based правилах;
- freshness/incompleteness markers для витрин;
- drill-down из агрегатов в сущности;
- export/report endpoints для управленческого потребления.

### Что не входит в модуль
- raw event collection как отдельная data platform;
- финансовые формулы beyond подключенных snapshot;
- ML/forecasting platform;
- ad-hoc BI конструктор уровня enterprise.

### Главный результат работы модуля
- пользователь получает быстрый слой управленческой аналитики, построенный на согласованных read-model, а не на тяжелых запросах к transactional данным.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin/Manager | Читает dashboard и drill-down | Основные потребители |
| Analytics service | Строит snapshots и рекомендации | Не является источником raw truth |
| Orders/Finance/Catalog/Inventory | Поставляют нормализованные данные | Внешние доменные источники |
| Product/Data | Управляют KPI definition и rule-set | Не должны менять historical snapshots бесследно |

## 4. Базовые сценарии использования

### Сценарий 1. Открытие dashboard
1. Пользователь выбирает период.
2. Backend читает готовые aggregates/read-model.
3. Возвращает KPI cards, trend series и ABC groups.
4. UI строит быструю витрину без тяжелых realtime joins.

### Сценарий 2. Drill-down по SKU
1. Пользователь кликает по KPI/ABC элементу.
2. Backend извлекает детальные данные по выбранной сущности и периоду.
3. UI показывает вклад SKU, группу ABC, динамику и рекомендации.

### Сценарий 3. Recommendation engine
1. Snapshot job применяет набор правил к агрегированным данным.
2. Создаются explainable recommendations с reason-code.
3. UI показывает рекомендации и может записывать факт пользовательского действия.

### Сценарий 4. Tenant уходит в `TRIAL_EXPIRED`
1. Tenant переводится в `TRIAL_EXPIRED`.
2. Уже построенные analytics snapshots остаются доступны.
3. Новые rebuild jobs и любые попытки подтянуть свежие внешние данные через integrations не выполняются.
4. UI показывает, что аналитика доступна в read-only/stale режиме на последних сохраненных данных.

## 5. Зависимости и интеграции

- Orders (primary source)
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)
- Sync / Marketplace Accounts (freshness and paused integration state)
- Catalog (атрибуты SKU)
- Finance (опционально для enriched-view)
- Inventory (low stock / stock-based recommendations)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/analytics/dashboard` | Owner/Admin/Manager | Главный dashboard |
| `GET` | `/api/v1/analytics/revenue-dynamics` | Owner/Admin/Manager | График выручки |
| `GET` | `/api/v1/analytics/abc` | Owner/Admin/Manager | ABC-классификация |
| `GET` | `/api/v1/analytics/products/top` | Owner/Admin/Manager | Топ товаров |
| `GET` | `/api/v1/analytics/products/:productId` | Owner/Admin/Manager | Drill-down SKU |
| `GET` | `/api/v1/analytics/recommendations` | Owner/Admin/Manager | Rule-based рекомендации |
| `GET` | `/api/v1/analytics/status` | Owner/Admin/Manager | Freshness, completeness и rebuild status |
| `GET` | `/api/v1/analytics/export` | Owner/Admin | Экспорт отчета |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/analytics/abc?from=2026-03-01&to=2026-03-31&groupBy=revenue' \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "groups": {
    "A": [{ "productId": "prd_1", "sharePct": 22.3 }],
    "B": [{ "productId": "prd_7", "sharePct": 8.1 }],
    "C": [{ "productId": "prd_12", "sharePct": 1.2 }]
  },
  "meta": { "periodFrom": "2026-03-01", "periodTo": "2026-03-31" }
}
```

### Frontend поведение

- Текущее состояние: маршрут `/app/analytics` уже существует и используется как текущий аналитический экран.
- Целевое состояние: нужны KPI cards, revenue dynamics, ABC, drill-down и recommendations в едином UX.
- UX-правило: аналитика должна объяснять действие, а не просто показывать цифры без контекста и рекомендаций.
- UI должен различать `fresh`, `stale`, `incomplete`: stale означает устаревший snapshot, incomplete означает нехватку части данных для конкретной метрики.
- Первый dashboard MVP показывает только базовый управленческий набор KPI: `revenue_net`, `orders_count`, `units_sold`, `avg_check`, `returns_count`, `top marketplace share`.
- При `TRIAL_EXPIRED` / `SUSPENDED` / `CLOSED` аналитика доступна для чтения, но rebuild/export через внешние integration-refresh сценарии не запускается.

## 8. Модель данных (PostgreSQL)

### `analytics_materialized_daily`
- `id UUID PK`, `tenant_id UUID`, `date DATE`
- `revenue_gross NUMERIC(14,2)`
- `revenue_net NUMERIC(14,2)`
- `orders_count INT`, `units_sold INT`, `returns_count INT`
- `avg_check NUMERIC(12,2)`
- `by_marketplace JSONB`
- `source_freshness JSONB NULL`
- `UNIQUE(tenant_id, date)`

### `analytics_abc_snapshots`
- `id UUID PK`, `tenant_id UUID`
- `period_from DATE`, `period_to DATE`
- `metric ENUM(revenue, units)`
- `formula_version VARCHAR(32) NOT NULL`
- `snapshot_status ENUM(ready, stale, incomplete, failed) NOT NULL DEFAULT 'ready'`
- `payload JSONB`
- `created_at`

### `analytics_recommendations`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID NULL`
- `rule_key VARCHAR(64)`, `priority ENUM(low, medium, high)`
- `reason_code VARCHAR(64) NOT NULL`
- `message TEXT`, `status ENUM(active, dismissed, applied)`
- `created_at`, `updated_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Daily job агрегирует normalized orders в `analytics_materialized_daily`.
2. Сервис проверяет freshness входных read-model и маркирует витрину как `ready/stale/incomplete`.
3. Dashboard читает агрегаты без тяжелых on-the-fly расчетов.
4. ABC строится по выбранному периоду и сохраняется snapshot с `formula_version`.
5. Rule engine создает рекомендации (например, low stock + high demand) только на explainable правилах.
6. Drill-down SKU строится из orders + materialized daily срезов + optional finance enrichments.

## 10. Валидации и ошибки

- Ограничить максимальный диапазон `to-from` для online запроса.
- rebuild запрещен при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
- Ошибки:
  - `VALIDATION_ERROR: PERIOD_TOO_LARGE`
  - `FORBIDDEN: ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE`
  - `NOT_FOUND: PRODUCT_ANALYTICS_NOT_FOUND`

## 11. Чеклист реализации

- [x] Data model: `AnalyticsMaterializedDaily`, `AnalyticsAbcSnapshot`, `AnalyticsRecommendation` + 4 enum + миграция (TASK_ANALYTICS_1).
- [x] Константы версий и rule-keys: `ANALYTICS_FORMULA_VERSION`, `ANALYTICS_RULE_KEYS`, `ANALYTICS_REASON_CODES`, `ABC_GROUP_THRESHOLDS` (TASK_ANALYTICS_1).
- [x] Daily aggregation pipeline (`AnalyticsAggregatorService`, upsert по `(tenantId, date)`, sourceFreshness, STALE marker) — TASK_ANALYTICS_2.
- [x] API dashboard/revenue-dynamics/top/drill-down (`AnalyticsReadService`, 4 эндпоинта + `POST /analytics/daily/rebuild`) — TASK_ANALYTICS_2.
- [x] API ABC: `GET /analytics/abc` + `POST /analytics/abc/rebuild` (deterministic ranking, formula versioning, A=80/B=15/C=5 по `revenue_net`) — TASK_ANALYTICS_3.
- [x] API recommendations/status/export: `GET /analytics/recommendations` (read-only ACTIVE), `POST /analytics/recommendations/refresh`, `GET /analytics/status`, `GET /analytics/export?target=daily|abc&format=csv|json` — TASK_ANALYTICS_4.
- [x] Rule-based recommendation engine: `AnalyticsRecommendationsService` (LOW_STOCK_HIGH_DEMAND, LOW_RATING, STALE_ANALYTICS_SOURCE) с idempotent upsert и engine-driven DISMISSED — TASK_ANALYTICS_4.
- [x] `AnalyticsPolicyService`: централизованный tenant-state guard для rebuild (daily / abc / recommendations) + `evaluateStaleness` (4 классификации FRESH/STALE/INCOMPLETE/BOTH) + `ANALYTICS_SOURCE_OF_TRUTH` контракт + `ANALYTICS_FORBIDS_INTEGRATION_REFRESH` flag; verdict прокинут в `getDashboard.freshness` и `getStatus.daily.freshness` — TASK_ANALYTICS_5.
- [x] Frontend `Analytics.tsx`: единый UX (period picker, freshness badge с 4 классификациями, KPI grid §13, revenue dynamics WB/Ozon, ABC pie + groups, top SKU table, read-only recommendations с RULE_LABEL+REASON_EXPLAIN, drill-down drawer, paused-banner с заблокированными rebuild кнопками, CSV export daily/abc); legacy on-the-fly endpoints больше не вызываются — TASK_ANALYTICS_6.
- [x] Observability + QA: `AnalyticsMetricsRegistry` (10 метрик §19), инструментация всех pipeline'ов (aggregator/abc/recommendations/read/export), endpoint `/analytics/metrics/snapshot` (Owner/Admin), regression matrix `analytics-regression.spec.ts` × 10 (KPI contract, ABC tie-breaker, policy-block × 3, recs без user workflow, export failures, stale views) — TASK_ANALYTICS_7.
- [x] Тесты консистентности агрегатов (read + aggregator, 18 тестов) — TASK_ANALYTICS_2.

## 12. Критерии готовности (DoD)

- Dashboard грузится быстро на production-объеме.
- ABC отчеты повторяемы и объяснимы.
- Drill-down корректно связан с исходными order данными.
- Для каждой витрины можно восстановить freshness и версию правила/формулы.
- Первый dashboard не перегружен и ограничен согласованным MVP-набором KPI.

## 13. Витрины и read models

### Что лучше не считать on-the-fly
- revenue dynamics по дням
- ABC-группы на больших периодах
- top SKU по tenant
- dashboard KPI по мультиканальному периоду

### Что допустимо считать онлайн
- небольшие drill-down по одному SKU
- пересчет recommendations по простым rule-based условиям

### KPI первого dashboard MVP
- `revenue_net`
- `orders_count`
- `units_sold`
- `avg_check`
- `returns_count`
- `top marketplace share`

## 14. Правила ABC-классификации

- сортировка SKU по убыванию выручки
- накопительная доля:
- `A` — первые 80%
- `B` — следующие 15%
- `C` — оставшиеся 5%

### Важно
- алгоритм должен быть детерминированным
- тай-брейк при равной выручке: `sku asc` или `product_id asc`

### Правило метрики для MVP
- ABC в MVP строим по `revenue_net`, а не по gross revenue, чтобы не смешивать продажи с еще не снятыми удержаниями/возвратным шумом.

## 15. Async и события

- daily aggregation jobs
- ABC snapshot rebuild jobs
- recommendation refresh jobs
- freshness recalculation jobs

### События
- `analytics_snapshot_built`
- `analytics_recommendation_created`

### MVP правило recommendations
- рекомендации в MVP остаются `rule-based read-only`;
- пользовательский workflow `dismiss/applied` не входит в первую версию;
- recommendation status используется только как internal delivery state, а не как пользовательский action log.

## 16. Тестовая матрица

- Dashboard на пустом tenant.
- Dashboard на периоде с продажами.
- ABC при одинаковой выручке у нескольких SKU.
- Top products с фильтром marketplace.
- Drill-down по SKU без продаж.
- Первый dashboard возвращает только согласованный MVP-набор KPI.
- stale analytics snapshot при paused integrations.
- rebuild blocked в `TRIAL_EXPIRED`.
- recommendations отображаются без пользовательских действий `dismiss/applied`.

## 17. Фазы внедрения

1. Daily materialized layer.
2. Dashboard + revenue dynamics.
3. ABC snapshot engine.
4. Top SKU + drill-down.
5. Recommendation engine и export.

## 18. Нефункциональные требования и SLA

- Dashboard и ABC отчеты должны читать готовые aggregates/read-model; прямой access к OLTP под тяжелую аналитику недопустим.
- Типовой отчет должен открываться быстро: `p95 < 700 мс`.
- Read-model rebuild должен быть воспроизводимым и version-aware.
- Export и drill-down не должны нарушать tenant isolation и RBAC.
- Analytics rebuild должен быть идемпотентным по `(tenant, period, view_type, formula_version)` или rebuild job key.

## 19. Observability, логи и алерты

- Метрики: `dashboard_opens`, `snapshot_build_duration`, `abc_recompute_count`, `recommendations_generated`, `export_failures`, `analytics_stale_views`.
- Логи: snapshot build runs, recommendation rule evaluation, drill-down query context, freshness decisions, formula version used.
- Алерты: stale read-model, рост failed exports, аномально долгий rebuild, empty dashboards for active tenants, массовый incomplete/stale state.
- Dashboards: analytics freshness board, export reliability, recommendation coverage board, stale-vs-incomplete board.

## 20. Риски реализации и архитектурные замечания

- Нельзя строить пользовательский analytics UX на “живых” транзакционных данных без snapshot strategy.
- ABC и recommendation logic должны быть explainable и versioned; иначе продукт потеряет доверие.
- Следует жестко отделить KPI definition от способа их визуализации, чтобы backend и frontend не расходились.
- Если в read-model смешать gross/net revenue без стандарта, последующая аналитика станет непригодной.
- Если analytics начнет сам инициировать integration refresh, модуль начнет конфликтовать с уже согласованными guards в `sync` и `finance`.
- Если в MVP сразу добавить workflow по рекомендациям, аналитический модуль начнет смешиваться с task-management и потеряет фокус.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю analytics больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены freshness/tenant-state guards, formula versioning и открытые решения по MVP KPI и recommendation workflow | Codex |
| 2026-04-18 | Подтверждены KPI первого dashboard и read-only rule-based recommendations для MVP | Codex |
| 2026-04-28 | TASK_ANALYTICS_1: заложен read-model слой — `AnalyticsMaterializedDaily`, `AnalyticsAbcSnapshot`, `AnalyticsRecommendation` + 4 enum + миграция; вынесены константы `ANALYTICS_FORMULA_VERSION` и rule/reason codes; legacy `analytics.service.ts` не тронут | Anvar |
| 2026-04-28 | TASK_ANALYTICS_2: добавлены `AnalyticsAggregatorService` (daily upsert, sourceFreshness, STALE marker) + `AnalyticsReadService` (4 эндпоинта: dashboard / revenue-dynamics / top / drill-down) + `POST /analytics/daily/rebuild` (Owner/Admin); первый dashboard ограничен MVP §13 KPI; 18 unit-тестов; legacy `/analytics/recommendations|geo|revenue-dynamics/legacy` сохранены | Anvar |
| 2026-04-28 | TASK_ANALYTICS_3: ABC engine — pure-function `AnalyticsAbcCalculatorService` (deterministic sort с tie-breaker `sku asc`, A=80/B=15/C=5, первый SKU всегда A) + orchestrator `AnalyticsAbcService` (loader + idempotent upsert, INCOMPLETE/STALE/READY, возвраты с минусом, SKU без active product пропускаются) + `GET /analytics/abc` + `POST /analytics/abc/rebuild`; 16 unit-тестов | Anvar |
| 2026-04-28 | TASK_ANALYTICS_4: rule engine `AnalyticsRecommendationsService` (LOW_STOCK_HIGH_DEMAND HIGH/MEDIUM, LOW_RATING, STALE_ANALYTICS_SOURCE) с idempotent upsert и engine-driven DISMISSED + `AnalyticsStatusService` (одним вызовом freshness/daily/abc/recommendations) + `AnalyticsExportService` (CSV/JSON по daily и abc); endpoints recommendations / recommendations/refresh / status / export; legacy on-the-fly recs перенесён под `/recommendations/legacy`; 17 unit-тестов | Anvar |
| 2026-04-28 | TASK_ANALYTICS_5: `AnalyticsPolicyService` — единый guard tenant state (TRIAL_EXPIRED/SUSPENDED/CLOSED → 403 ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE) для daily/abc/recommendations rebuild; static `isLastEventStale` использует `ANALYTICS_STALE_SOURCE_WINDOW_HOURS=48` единым окном; `evaluateStaleness` отдаёт 4 классификации, прокинуто в dashboard.freshness и status.daily.freshness; load-bearing constants `ANALYTICS_SOURCE_OF_TRUTH` + `ANALYTICS_FORBIDS_INTEGRATION_REFRESH` с regression spec; 23 unit-теста policy + старые специ обновлены на DI policy | Anvar |
| 2026-04-28 | TASK_ANALYTICS_6: полная переработка `Analytics.tsx` под новые витрины — period picker, SnapshotMetaCard с 4-цветным freshness бейджем, KpiGrid строго §13 (без gross), revenue dynamics WB/Ozon, ABC pie + group breakdown с rebuild placeholder'ом, Top SKU таблица, read-only `RecommendationsCard` без dismiss/applied кнопок, drill-down drawer (KPI + recent orders), paused banner с заблокированными rebuild/refresh, CSV export через `window.open`; legacy `/analytics/recommendations|geo|revenue-dynamics/legacy` больше не вызываются из UI; tsc clean | Anvar |
| 2026-04-28 | TASK_ANALYTICS_7: `AnalyticsMetricsRegistry` (10 метрик §19) + инструментация aggregator/abc/recommendations/read/export (latency p50/p95, REBUILD_BLOCKED_BY_TENANT по target, RECOMMENDATIONS_GENERATED per ruleKey, STALE_VIEWS, EXPORT_SUCCESS/FAILURES); endpoint `/analytics/metrics/snapshot` (Owner/Admin); 2 новых spec — `analytics.metrics.spec.ts` (6) + `analytics-regression.spec.ts` × 10 (полная §16 матрица); 92/92 тестов в 10 suite | Anvar |
