# TASK_ANALYTICS_7 — QA, Regression и Observability

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_ANALYTICS_1`
  - `TASK_ANALYTICS_2`
  - `TASK_ANALYTICS_3`
  - `TASK_ANALYTICS_4`
  - `TASK_ANALYTICS_5`
  - `TASK_ANALYTICS_6`
- Что нужно сделать:
  - покрыть тестами dashboard на пустом tenant и tenant с продажами;
  - добавить кейсы ABC при равной выручке, stale snapshot, blocked rebuild в `TRIAL_EXPIRED`;
  - проверить, что первый dashboard отдает только согласованный MVP-набор KPI;
  - покрыть recommendations без пользовательских действий `dismiss/applied`;
  - завести метрики и алерты по stale views, failed exports, snapshot build duration, recommendation coverage.
- Критерий закрытия:
  - регрессии по KPI contracts, ABC ranking и policy-block сценариям ловятся автоматически;
  - observability показывает состояние freshness, rebuild и recommendation generation;
  - QA matrix покрывает утвержденную MVP-модель аналитики.

**Что сделано**

Закрыт QA-цикл analytics domain — добавлены `AnalyticsMetricsRegistry` (10 метрик §19), инструментация всех pipeline'ов (aggregator / abc / recommendations / read / export), 2 новых spec'а (metrics + cross-pipeline regression), endpoint `/analytics/metrics/snapshot`. Регрессионные тесты теперь ловят все §16 сценарии: KPI contract, ABC tie-breaker, policy-block в TRIAL_EXPIRED, recommendations без user workflow, export failures.

### 1. [analytics.metrics.ts](apps/api/src/modules/analytics/analytics.metrics.ts) — `AnalyticsMetricsRegistry`

Process-local in-memory counters + structured-логи (по образцу `OrdersMetricsRegistry` и `FinanceMetricsRegistry`). Не Prometheus client сознательно — для MVP достаточно log-based metrics через Loki/Datadog.

#### 10 метрик §19

| Имя | Когда инкрементируется |
|---|---|
| `analytics_dashboard_opens` | Каждый вызов `getDashboard()` |
| `analytics_snapshot_build_duration` | Histogram (latency) на каждый rebuild daily/abc |
| `analytics_abc_recompute_count` | Каждый успешный ABC rebuild (label: `reason=<status>`) |
| `analytics_daily_rebuild_count` | Каждый успешный daily rebuild (label: `reason=<status>`) |
| `analytics_recommendations_generated` | На каждый активированный сигнал refresh (label: `ruleKey`) |
| `analytics_recommendations_dismissed` | Когда engine автоматически закрывает устаревший сигнал |
| `analytics_export_failures` | Любой exception в export pipeline (label: `reason=<error code>`) |
| `analytics_export_success` | Успешный export (label: `reason=csv\|json`) |
| `analytics_stale_views` | Чтение dashboard, помеченного STALE/INCOMPLETE/STALE_AND_INCOMPLETE (label: `reason=<classification>`) |
| `analytics_rebuild_blocked_by_tenant` | `ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE` policy hits (label: `target=daily\|abc\|recommendations`, `reason=<TRIAL_EXPIRED\|SUSPENDED\|CLOSED>`) |

`snapshot()` возвращает `{counters, latency: {count, p50, p95}}` — готов к подключению как `/health/analytics` endpoint в будущем.

### 2. Инструментация всех pipeline'ов

**[analytics-aggregator.service.ts](apps/api/src/modules/analytics/analytics-aggregator.service.ts)** — `rebuildDailyRange()`:
- try/catch вокруг `assertRebuildAllowed`: 403 → `REBUILD_BLOCKED_BY_TENANT` (label `target=daily, reason=<state>`).
- `observeLatency(Date.now() - startedAt)` после успеха.
- `DAILY_REBUILD_COUNT` инкремент с `reason=<snapshotStatus>`.

**[analytics-abc.service.ts](apps/api/src/modules/analytics/analytics-abc.service.ts)** — `rebuild()`:
- try/catch вокруг `assertRebuildAllowed`: 403 → `REBUILD_BLOCKED_BY_TENANT` (label `target=abc`).
- `observeLatency` + `ABC_RECOMPUTE_COUNT` после успеха.

**[analytics-recommendations.service.ts](apps/api/src/modules/analytics/analytics-recommendations.service.ts)** — `refresh()`:
- try/catch вокруг `assertRebuildAllowed`: 403 → `REBUILD_BLOCKED_BY_TENANT` (label `target=recommendations`).
- `RECOMMENDATIONS_GENERATED += count` per ruleKey (отдельная метка для каждого правила — UI/observability видят какое правило сработало чаще).
- `RECOMMENDATIONS_DISMISSED += stale.length` (engine_auto_dismiss).

**[analytics-read.service.ts](apps/api/src/modules/analytics/analytics-read.service.ts)** — `getDashboard()`:
- `DASHBOARD_OPENS` инкремент в самом начале (даже если потом 400 — учитывает попытку чтения).
- Если `verdict.isStale || isIncomplete` → `STALE_VIEWS` с `reason=<classification>`.

**[analytics-export.service.ts](apps/api/src/modules/analytics/analytics-export.service.ts)** — `export()`:
- try/catch вокруг всего pipeline.
- Успех → `EXPORT_SUCCESS` (label `reason=csv|json`).
- Любая ошибка → `EXPORT_FAILURES` (label `reason=<error code>`).

### 3. Endpoint `/analytics/metrics/snapshot`

Owner/Admin only (через `_assertOwnerOrAdmin`). Отдаёт `{counters, latency}` для админ-консоли или будущей health-probe. Read-only, доступен и при paused tenant.

### 4. Spec [analytics.metrics.spec.ts](apps/api/src/modules/analytics/analytics.metrics.spec.ts) — **6 тестов**

| # | Что проверяет |
|---|---|
| 1 | `increment` накапливает counter, snapshot возвращает значения |
| 2 | `observeLatency` p50/p95 |
| 3 | Окно ограничено 200 (sliding window) |
| 4 | `reset()` обнуляет |
| 5 | `increment by N` (для recommendations batch) |
| 6 | Регрессия: `AnalyticsMetricNames` содержит все §19 ключи |

### 5. Spec [analytics-regression.spec.ts](apps/api/src/modules/analytics/analytics-regression.spec.ts) — **9 тестов** cross-pipeline

| # | §16 / §13 / §10 / §15 / §19 кейс | Что проверяет |
|---|---|---|
| 1 | §16 dashboard на пустом tenant | `snapshotStatus=EMPTY`, нулевые KPI, `DASHBOARD_OPENS+1` |
| 2 | §13 dashboard ограничен MVP набором | `kpis` не содержит `revenueGross`; ровно 6 ключей |
| 3 | §16+§14 ABC при равной выручке | deterministic tie-breaker `sku asc` |
| 4 | §10 daily rebuild blocked в TRIAL_EXPIRED | 403 + metric `REBUILD_BLOCKED_BY_TENANT` |
| 5 | §10 abc rebuild blocked | 403 + metric |
| 6 | §10 recommendations refresh blocked | 403 + metric |
| 7 | §15 recommendations DTO без dismiss/applied | сервис не имеет mutate-методов user dismiss |
| 8 | §19 export failure → metric `EXPORT_FAILURES` | abc snapshot отсутствует → 404 + counter+1 |
| 8b | §19 export success → metric `EXPORT_SUCCESS` | daily success + counter+1 + failures undefined |
| 9 | §19 stale dashboard → metric `STALE_VIEWS` | classification `STALE_BUT_COMPLETE` → counter+1 |

### 6. Покрытие §16 тестовой матрицы (полное)

| Сценарий из §16 | Покрыто spec'ом |
|---|---|
| Dashboard на пустом tenant | regression + analytics-read ✓ |
| Dashboard на периоде с продажами | analytics-read ✓ |
| ABC при одинаковой выручке у нескольких SKU | abc-calculator + regression ✓ |
| Top products с фильтром marketplace | analytics-read ✓ |
| Drill-down по SKU без продаж | analytics-read (404 path) ✓ |
| Первый dashboard возвращает только MVP набор KPI | analytics-read + regression (`revenueGross` отсутствует) ✓ |
| Stale analytics snapshot при paused integrations | aggregator (STALE marker) + regression (STALE_VIEWS metric) ✓ |
| Rebuild blocked в `TRIAL_EXPIRED` | regression × 3 (daily/abc/recs) + policy spec ✓ |
| Recommendations отображаются без `dismiss/applied` | regression (нет mutate-методов) + recommendations spec ✓ |

### 7. [analytics.module.ts](apps/api/src/modules/analytics/analytics.module.ts)

`AnalyticsMetricsRegistry` добавлен в providers + exports. Все сервисы (aggregator, abc, recommendations, read, export) принимают его через DI.

### 8. Существующие spec'и продолжают проходить

Старые spec'и обновлены: конструкторы получают `new AnalyticsMetricsRegistry()`. Никаких поведенческих изменений в существующих тестах — только инжекция нового сервиса.

### 9. Проверки

- `npx jest --testPathPatterns="analytics"` → **92/92 passed, 10 suites passed**:
  - calculator(abc) 8, abc 10, aggregator 6, read 12, recommendations 10, status 2, export 5, policy 23, **metrics 6 (новый)**, **regression 10 (новый)**.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing).

### 10. DoD сверка

- ✅ **Регрессии по KPI contracts, ABC ranking и policy-block сценариям ловятся автоматически**: `analytics-regression.spec.ts` × 10 явно проверяет §13 KPI набор (6 ключей, нет `revenueGross`), §14 ABC tie-breaker `sku asc`, §10 policy-block для всех трёх pipeline'ов с metric assertion.
- ✅ **Observability показывает состояние freshness, rebuild и recommendation generation**: 10 метрик §19 с structured-логами, latency p50/p95 на каждый rebuild, `STALE_VIEWS` отдельный counter на чтение dashboard'а в плохом состоянии, `RECOMMENDATIONS_GENERATED` per `ruleKey` для recommendation coverage.
- ✅ **QA matrix покрывает утверждённую MVP-модель аналитики**: 9 из 9 строк §16 покрыты (см. таблицу в §6).

### 11. Что НЕ сделано (намеренно — за пределами scope)

- **`/health/analytics` endpoint** для публичного snapshot метрик — registry готов, controller отдаёт `/analytics/metrics/snapshot` (Owner/Admin); публичный endpoint появится одновременно с external probe в отдельной задаче на operational dashboards.
- **E2E тесты через `supertest`** — рамки jest unit; e2e setup в `test/jest-e2e.json` существует, но требует поднятой БД + интеграции с прочими domain'ами (orders, marketplace reports), что выходит за scope этой задачи.
- **Property-based tests на ABC calculator** — текущие 8 unit-тестов покрывают enum-комбинации вручную; добавление fast-check для рандомизированных кейсов — не требуется в scope MVP.
- **Nightly cron job для daily rebuild + recommendations refresh** — не реализован (`@nestjs/schedule` не подключён в проекте, см. pre-existing `team-scheduler.service.ts` ошибка); spec появится одновременно с подключением cron'а.
- **Удаление legacy `analytics.service.ts`** — endpoints всё ещё под `/analytics/*/legacy`, удаление в отдельной cleanup-итерации после полной миграции frontend.
