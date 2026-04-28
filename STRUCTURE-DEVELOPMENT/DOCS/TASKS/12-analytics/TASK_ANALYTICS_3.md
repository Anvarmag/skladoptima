# TASK_ANALYTICS_3 — ABC Snapshot Engine, Formula Versioning и Deterministic Ranking

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_ANALYTICS_1`
  - `TASK_ANALYTICS_2`
- Что нужно сделать:
  - реализовать `GET /api/v1/analytics/abc`;
  - строить ABC snapshot по `revenue_net`, а не по gross revenue;
  - закрепить rule `A=80%`, `B=15%`, `C=5%`;
  - добавить deterministic tie-breaker при равной выручке: `sku asc` или `product_id asc`;
  - version-ировать ABC формулу и rebuild policy.
- Критерий закрытия:
  - ABC отчет повторяем, объясним и не зависит от нестабильного порядка данных;
  - net revenue policy соблюдается во всех срезах;
  - snapshot layer пригоден для rebuild и auditability.

**Что сделано**

ABC engine реализован двумя сервисами + 2 эндпоинтами + 16 unit-тестами. Калькулятор отделён от orchestrator'а — это позволяет прогнать формулу без mock'ов БД и гарантирует, что любые изменения формулы попадают под версию `ANALYTICS_FORMULA_VERSION`.

### 1. [analytics-abc-calculator.service.ts](apps/api/src/modules/analytics/analytics-abc-calculator.service.ts) — pure function

**Контракт §14:**
- метрика — `revenue_net` (для MVP; `UNITS` зарезервирован под будущий drill-down — поддерживается parameter'ом);
- сортировка по убыванию метрики;
- **deterministic tie-breaker**: при равных значениях — `sku asc`, при равных sku — `productId asc`. Это гарантия §20 «ABC должен быть explainable и повторяемым» — без tie-breaker'а порядок зависел бы от undefined Postgres sort и snapshot становился non-reproducible;
- SKU с `metricValue<=0` пропускаются (не классифицируются — нулевая выручка не размывает процентные доли);
- группа определяется по накопительной доле **до включения текущего SKU** — это даёт два важных свойства:
  - первый SKU **всегда A** (даже если он один и его доля = 100%);
  - граница 80% включается в A: при ровно 80% накоплении следующий SKU попадает в B (как и описано в §14 — A это «первые 80%»).

**Формат вывода:** `{rows[], totals: {skuCount, totalMetric, groupCounts, groupShares}}`. Каждый row содержит `productId, sku, metricValue, sharePct, cumulativeShare, group, rank` — UI рендерит без дополнительных вычислений.

### 2. [analytics-abc.service.ts](apps/api/src/modules/analytics/analytics-abc.service.ts) — orchestrator

Loader (per-SKU revenue) → Calculator → Persist. Контракт §13 + §15 + §20:

- **rebuild идемпотентен** через `prisma.analyticsAbcSnapshot.upsert` по UNIQUE`(tenantId, periodFrom, periodTo, metric, formulaVersion)` — повторный rebuild того же периода с той же metric/formulaVersion перезаписывает payload (`wasReplaced=true`); смена metric/formulaVersion создаёт **отдельный** snapshot, чтобы не терять историю интерпретации;
- **rebuild не дёргает marketplace API** — работает только по уже нормализованным `MarketplaceOrder`;
- per-SKU выручка собирается с учётом **возвратов** (`status` содержит `return / cancel / возврат` → метрика с минусом — единый контракт с aggregator'ом TASK_ANALYTICS_2);
- SKU без активного `Product` (soft-deleted или из чужого tenant) пропускается — ABC привязан к Product, не к raw sku;
- `snapshotStatus` определяется по правилам:
  - пустой результат → `INCOMPLETE` (нечего классифицировать);
  - источник `STALE` (orders старше 48h) → `STALE`;
  - иначе → `READY`.
- `getSnapshot(tenantId, period, metric?)` читает по UNIQUE без exception при отсутствии — UI рисует пустой ABC, rebuild — отдельный вызов;
- валидация периода: `to >= from`, `days <= ANALYTICS_MAX_PERIOD_DAYS=366` (`ANALYTICS_PERIOD_INVALID / TOO_LARGE`).

**Payload snapshot'а:** `{generatedFormula, totals, groups: {A[], B[], C[]}, items[]}`. Денормализован сознательно — UI открывает ABC экран и читает один JSONB без N+1.

### 3. DTO [dto/analytics-period.dto.ts](apps/api/src/modules/analytics/dto/analytics-period.dto.ts) — расширены

- `AbcQueryDto` — `from`, `to`, опциональный `metric` (`REVENUE_NET | UNITS`).
- `RebuildAbcDto` — то же.

### 4. [analytics.controller.ts](apps/api/src/modules/analytics/analytics.controller.ts) — добавлены endpoints

```
GET   /analytics/abc?from=&to=&metric=         # read snapshot, null если не построен
POST  /analytics/abc/rebuild  body: {from, to, metric?}    # Owner/Admin
```

Read доступен при `RequireActiveTenantGuard` (paused tenant читает уже построенные snapshots — §4 сценарий 4). Write — `TenantWriteGuard` + role check (Owner/Admin) внутри controller'а.

### 5. [analytics.module.ts](apps/api/src/modules/analytics/analytics.module.ts) — обновлён

Добавлены providers/exports: `AnalyticsAbcCalculatorService`, `AnalyticsAbcService`.

### 6. Spec покрытие — 16 тестов

[analytics-abc-calculator.spec.ts](apps/api/src/modules/analytics/analytics-abc-calculator.spec.ts) — **8 тестов**:

| # | Что проверяет |
|---|---|
| 1 | пустой вход → пустой результат |
| 2 | SKU с metricValue<=0 пропускаются |
| 3 | сортировка по revenue desc + группы A/B/C при 80/15/5 |
| 4 | deterministic tie-breaker: при равной выручке — sku asc, ranks стабильны |
| 5 | повторяемость: одинаковый вход → одинаковый порядок и группы независимо от исходного порядка |
| 6 | граница 80% включается в A (первый SKU) |
| 7 | totals.groupCounts корректны |
| 8 | один SKU с любой выручкой → A (а не C из-за float overflow) |

[analytics-abc.spec.ts](apps/api/src/modules/analytics/analytics-abc.spec.ts) — **8 тестов**:

| # | Что проверяет |
|---|---|
| 1 | пустые orders → INCOMPLETE snapshot |
| 2 | happy path 3 SKU → READY, корректные groupCounts |
| 3 | возврат вычитается из per-SKU выручки |
| 4 | SKU без активного product пропускается |
| 5 | STALE источник → snapshotStatus=STALE |
| 6 | повторный rebuild → wasReplaced=true |
| 7 | getSnapshot отсутствует → snapshot=null без exception |
| 8 | getSnapshot есть → возвращает payload + meta |
| (+) | period.to < from → 400; > 366 дней → 400 |

### 7. Проверки

- `npx jest --testPathPatterns="analytics"` → **36/36 passed, 4 suites passed** (analytics-read 12 + analytics-aggregator 6 + analytics-abc-calculator 8 + analytics-abc 10 — 8 поведенческих + 2 валидации).
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing).

### 8. DoD сверка

- ✅ **ABC отчёт повторяем, объясним и не зависит от нестабильного порядка данных**: deterministic sort `(metric desc, sku asc, productId asc)` + pure-function calculator + spec на повторяемость (одинаковый вход → одинаковый rank/group независимо от порядка входа).
- ✅ **Net revenue policy соблюдается во всех срезах**: loader считает per-SKU revenue по тому же правилу возвратов, что aggregator (TASK_ANALYTICS_2); метрика — `REVENUE_NET` (gross в MVP не используется).
- ✅ **Snapshot layer пригоден для rebuild и auditability**: UNIQUE`(tenantId, periodFrom, periodTo, metric, formulaVersion)` — каждая комбинация — отдельный snapshot; `formulaVersion` зафиксирован константой; `wasReplaced` возвращается явно; `generatedAt` обновляется при rebuild.

### 9. Что НЕ сделано (намеренно — за пределами scope)

- **Recommendations engine** — TASK_ANALYTICS_4.
- **`/analytics/status` + `/analytics/export`** — TASK_ANALYTICS_4.
- **`AnalyticsPolicyService` + tenant-state guard для rebuild** — TASK_ANALYTICS_5 (сейчас гард приходит «бесплатно» от `TenantWriteGuard`).
- **Frontend ABC UX** — TASK_ANALYTICS_6.
- **Метрики/observability** — TASK_ANALYTICS_7.
- **`UNITS` метрика** — поддерживается parameter'ом и loader'ом, но в MVP UI не задействует; полное покрытие — будущая итерация.
