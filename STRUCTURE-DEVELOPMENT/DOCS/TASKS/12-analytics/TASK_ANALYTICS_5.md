# TASK_ANALYTICS_5 — Tenant-State Guards, Freshness/Incomplete Policy и Source Contracts

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ANALYTICS_2`
  - `TASK_ANALYTICS_3`
  - `TASK_ANALYTICS_4`
  - согласованы `02-tenant`, `09-sync`, `11-finance`
- Что нужно сделать:
  - заблокировать rebuild при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - оставить analytics snapshots доступными для чтения при paused tenant;
  - различать `fresh`, `stale`, `incomplete` как разные состояния;
  - не допускать runtime integration refresh из analytics слоя;
  - закрепить source contracts с orders, finance, catalog, inventory без обходных источников.
- Критерий закрытия:
  - analytics не конфликтует с guards из sync и finance;
  - stale и incomplete semantics не смешиваются;
  - read-only режим при paused tenant работает предсказуемо.

**Что сделано**

Введён `AnalyticsPolicyService` — централизованный guard + source contract layer по аналогии с `FinancePolicyService`. Все три rebuild-операции (daily / abc / recommendations refresh) теперь обязательно проходят через единый `assertRebuildAllowed`. Verdict freshness прокинут наружу в dashboard и status response, чтобы frontend (TASK_ANALYTICS_6) рисовал бейдж по одному и тому же контракту.

### 1. [analytics-policy.service.ts](apps/api/src/modules/analytics/analytics-policy.service.ts)

**Single source of truth для tenant policy**:
- `assertRebuildAllowed(tenantId)` — кидает `403 ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE` при `TRIAL_EXPIRED / SUSPENDED / CLOSED`. Семантика и набор PAUSED состояний идентичны `FinancePolicyService` — analytics не конфликтует с finance/sync guards (DoD).
- `isReadAllowed(tenantId)` — read разрешён даже при `CLOSED` (§4 сценарий 4: history read-only). Возвращает `true` для всех существующих tenant'ов; future-policy hook для post-retention.
- structured-лог `analytics_rebuild_blocked` пишется самим сервисом — caller'ы не дублируют.

**Source-of-truth contracts (§13)**:

```ts
ANALYTICS_SOURCE_OF_TRUTH = {
    daily_layer: 'MarketplaceOrder (нормализованные заказы) — НЕ raw marketplace API',
    abc_snapshot: 'MarketplaceOrder + Product — нормализованные заказы, НЕ raw API',
    recommendations_low_stock: 'StockBalance + MarketplaceOrder — нормализованные источники',
    recommendations_low_rating: 'Product.rating — нормализованный каталог',
    recommendations_stale: 'MarketplaceOrder.marketplaceCreatedAt — нормализованный feed, НЕ raw ping',
    export: 'AnalyticsMaterializedDaily / AnalyticsAbcSnapshot — materialized, НЕ live OLTP',
    status: 'Aggregate of materialized views — НЕ raw marketplace API ping',
}
ANALYTICS_FORBIDS_INTEGRATION_REFRESH = true
```

Это load-bearing документация — regression spec проверяет что:
- ни одна запись не разрешает raw marketplace API;
- флаг `ANALYTICS_FORBIDS_INTEGRATION_REFRESH` не сменился на `false`;
- все ключевые витрины перечислены (`daily_layer`, `abc_snapshot`, recs ×3, `export`, `status`).

**Stale-vs-Incomplete distinction (§19 board)**:

```ts
evaluateStaleness({sourceFreshness, snapshotStatus}) → {isStale, isIncomplete, classification}
classification:
  FRESH_AND_COMPLETE     // показываем без disclaimers
  STALE_BUT_COMPLETE     // источники старые, но KPI вычислены
  INCOMPLETE_BUT_FRESH   // источники свежие, но missing critical
  STALE_AND_INCOMPLETE   // обе проблемы; UI показывает максимум warnings, НЕ скрывает данные
```

Это §19 правило в одной enum-строке: incomplete data ≠ stale snapshot, и UX обязан их различать.

**Static helper `isLastEventStale(lastAt, asOf?)`** — единая точка применения окна `ANALYTICS_STALE_SOURCE_WINDOW_HOURS=48` для всех loader'ов (aggregator, abc, recommendations). Раньше каждый сервис считал stale сам — теперь только через policy.

### 2. Wiring policy во все rebuild-операции

**[analytics-aggregator.service.ts](apps/api/src/modules/analytics/analytics-aggregator.service.ts)** — `rebuildDailyRange` теперь начинается с `await this.policy.assertRebuildAllowed(tenantId)`. `_evaluateOrdersFreshness` использует `AnalyticsPolicyService.isLastEventStale`.

**[analytics-abc.service.ts](apps/api/src/modules/analytics/analytics-abc.service.ts)** — `rebuild` теперь начинается с `assertRebuildAllowed`. `_evaluateSourceFreshness` использует `isLastEventStale`.

**[analytics-recommendations.service.ts](apps/api/src/modules/analytics/analytics-recommendations.service.ts)** — `refresh` теперь начинается с `assertRebuildAllowed`. `_evaluateStaleSource` остался как есть (имеет own `asOf` для тестов), но единый константный порог 48h импортируется из `analytics.constants`.

> Тонкость: `getSnapshot` и `list` НЕ дёргают policy — read остаётся доступным даже при paused tenant (§4).

### 3. Прокинутый verdict в read APIs

**[analytics-read.service.ts](apps/api/src/modules/analytics/analytics-read.service.ts)**:
- `DashboardResponse` теперь содержит поле `freshness: SnapshotFreshnessVerdict | null`.
- При пустом snapshot → `null`.
- При наличии данных вычисляется через `policy.evaluateStaleness({sourceFreshness, snapshotStatus})` — UI читает `freshness.classification` для рендера бейджа.

**[analytics-status.service.ts](apps/api/src/modules/analytics/analytics-status.service.ts)**:
- `daily.freshness` — verdict по daily витрине, рассчитанный по dominant статусу из `statusBreakdown` (FAILED > STALE > INCOMPLETE > READY) + `sources.orders.isStale`.

### 4. [analytics.module.ts](apps/api/src/modules/analytics/analytics.module.ts) — обновлён

Добавлены providers/exports `AnalyticsPolicyService`. Все сервисы, дёргающие rebuild/refresh, инжектят policy через DI.

### 5. Spec покрытие — 23 новых теста (8 suites total)

[analytics-policy.spec.ts](apps/api/src/modules/analytics/analytics-policy.spec.ts) — **23 теста**:

| Группа | Что проверяет |
|---|---|
| `assertRebuildAllowed` | allows: `ACTIVE_PAID / TRIAL_ACTIVE / EARLY_ACCESS / GRACE_PERIOD` (4); blocks: `TRIAL_EXPIRED / SUSPENDED / CLOSED` → 403 (3); tenant не существует → 403 (1) |
| `isReadAllowed` | разрешён при ВСЕХ paused состояниях (4); tenant не существует → false (1) |
| `evaluateStaleness` | 4 классификации + STALE через snapshotStatus без sourceFreshness (5) |
| `isLastEventStale` (static) | null, < 48h, > 48h (3) |
| Source-of-truth contracts | `ANALYTICS_FORBIDS_INTEGRATION_REFRESH===true`; `ANALYTICS_SOURCE_OF_TRUTH` покрывает 7 ключевых витрин и каждая запись отмечена как «нормализованн / materialized / не raw / не live / aggregate» (regression на §13) (2) |

Старые spec'и обновлены: AccessState добавлен в `jest.mock('@prisma/client')`, конструкторы сервисов получают stub policy с `assertRebuildAllowed` resolving + `evaluateStaleness` returning verdict.

### 6. Проверки

- `npx jest --testPathPatterns="analytics"` → **76/76 passed, 8 suites passed**:
  - calculator(abc) 8, abc 10, aggregator 6, read 12, recommendations 10, status 2, export 5, **policy 23 (новый)**.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing).

### 7. DoD сверка

- ✅ **Analytics не конфликтует с guards из sync и finance**: `AnalyticsPolicyService` использует тот же набор `PAUSED_TENANT_STATES` (`TRIAL_EXPIRED / SUSPENDED / CLOSED`), что `FinancePolicyService` и tenant `RequireActiveTenantGuard` / `TenantWriteGuard`. Семантика и error code (`*_BLOCKED_BY_TENANT_STATE`) идентичны.
- ✅ **Stale и incomplete semantics не смешиваются**: `evaluateStaleness` возвращает 4 классификации; `STALE` зависит ТОЛЬКО от `sourceFreshness` или `snapshotStatus=STALE`; `INCOMPLETE` — ТОЛЬКО от `snapshotStatus=INCOMPLETE`; обе одновременно → `STALE_AND_INCOMPLETE`. Покрыто 4 spec'ами.
- ✅ **Read-only режим при paused tenant работает предсказуемо**: `isReadAllowed` возвращает `true` для всех paused; `getSnapshot / list / getDashboard / getStatus / export(daily|abc)` НЕ вызывают `assertRebuildAllowed` — read доступен; `rebuild*` все вызывают и падают 403. Поведение симметрично finance модулю.

### 8. Что НЕ сделано (намеренно — за пределами scope)

- **Frontend перерисовка с новыми бейджами `freshness.classification`** — TASK_ANALYTICS_6.
- **Метрики/observability + nightly cron** — TASK_ANALYTICS_7.
- **Удаление legacy `analytics.service.ts`** — после переключения frontend.
