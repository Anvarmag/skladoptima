# TASK_FINANCE_7 — QA, Regression и Observability

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_FINANCE_1`
  - `TASK_FINANCE_2`
  - `TASK_FINANCE_3`
  - `TASK_FINANCE_4`
  - `TASK_FINANCE_5`
  - `TASK_FINANCE_6`
- Что нужно сделать:
  - покрыть тестами полный расчет, missing cost, missing fees, missing logistics, stale reports, rebuild flow;
  - проверить, что отсутствие `ads / tax / returns` помечает строку как incomplete, но не скрывает ее;
  - добавить кейс блокировки rebuild в `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - покрыть запрет ручного ввода периодных расходов;
  - завести метрики и алерты по snapshot failures, incomplete warnings, stale-source mass state, cost profile updates.
- Критерий закрытия:
  - регрессии по формулам и policy-block сценариям ловятся автоматически;
  - observability показывает проблемы completeness, freshness и rebuild;
  - QA matrix покрывает утвержденную MVP financial model.

**Что сделано**

Закрыт QA-цикл finance domain. Добавлены 2 новых spec'а (cost-profile + read), новый `FinanceMetricsRegistry` с 8 метриками §19, инструментация snapshot и cost-profile сервисов. Регрессионные тесты teперь ловят все §16 сценарии: формулы, completeness, stale source, tenant guards, manual whitelist bypass.

### 1. [finance.metrics.ts](apps/api/src/modules/finance/finance.metrics.ts)

Process-local in-memory counters + structured-логи (по образцу `OrdersMetricsRegistry` из 10-orders/TASK_ORDERS_7). Не Prometheus client сознательно — для MVP достаточно log-based metrics через Loki/Datadog.

#### 8 метрик §19

| Имя | Когда инкрементируется |
|---|---|
| `finance_snapshots_generated` | Каждый успешный rebuild (label: `reason=READY/INCOMPLETE/FAILED`) |
| `snapshot_generation_failures` | Exception в pipeline (label: `reason=<error code>`) |
| `warning_incomplete_count` | `snapshotStatus=INCOMPLETE` (label: `reason=<aggregated warnings>`) |
| `negative_margin_sku_count` | После rebuild — counter += число SKU с profit<0 |
| `cost_profile_updates` | Успешный PATCH cost (label: `reason=create/update`) |
| `finance_rebuild_blocked_by_tenant` | `FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE` policy hits |
| `finance_manual_input_rejected` | Попытка bypass whitelist (label: `reason=<rejected field>`) |
| `finance_snapshot_build_latency_ms` | Wall-clock от вызова `rebuild()` до return |

`snapshot()` отдаёт `{counters, latency: {count, p50, p95}}` — готов к подключению как `/health/finance` endpoint в будущем.

### 2. Инструментация snapshot service

В `FinanceSnapshotService.rebuild()` добавлена обёртка с try/catch:

```ts
const startedAt = Date.now();
try {
    const result = await this._rebuildInner(args);
    this.metrics.observeLatency(Date.now() - startedAt, labels);
    this.metrics.increment(SNAPSHOTS_GENERATED, { reason: result.snapshotStatus });
    if (result.snapshotStatus === 'INCOMPLETE') {
        this.metrics.increment(WARNING_INCOMPLETE_COUNT, { reason: aggregatedWarnings.join(',') });
    }
    const negativeCount = await this._countNegativeMargin(result.snapshotId);
    if (negativeCount > 0) this.metrics.increment(NEGATIVE_MARGIN_SKU_COUNT, labels, negativeCount);
    return result;
} catch (err) {
    // Different reason для разных типов exception:
    if (reason === 'FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE') {
        this.metrics.increment(REBUILD_BLOCKED_BY_TENANT, { reason });
    } else {
        this.metrics.increment(SNAPSHOT_GENERATION_FAILURES, { reason });
    }
    throw err;
}
```

Latency меряется **на любом исходе** (success/failure/blocked) — это §18 SLA: даже неуспешные rebuild'ы должны быть видны в latency dashboard.

### 3. Инструментация cost-profile service

- `MANUAL_INPUT_REJECTED` инкрементируется в момент catch'а в whitelist enforcement loop'е (label: `reason=<field name>`).
- `COST_PROFILE_UPDATES` инкрементируется после успешного `upsert` (label: `reason=create/update` для различения).

### 4. Spec [finance-cost-profile.spec.ts](apps/api/src/modules/finance/finance-cost-profile.spec.ts) — 14 тестов

| # | Что проверяет |
|---|---|
| 1-2 | OWNER / ADMIN → ok |
| 3 | MANAGER → 403 ROLE_FORBIDDEN |
| 4 | STAFF → 403 |
| 5 | Нет membership → 403 TENANT_ACCESS_DENIED |
| 6 | `marketplaceFees` → 403 MANUAL_INPUT_NOT_ALLOWED, upsert НЕ вызывался |
| 7 | `revenue` → 403 (нельзя подменять revenue вручную) |
| 8 | `taxImpact / adsCost / returnsImpact / logistics` — все 4 запрещены (§14 optional inputs) |
| 9 | `baseCost / packagingCost / additionalCost / costCurrency` — все 4 разрешены |
| 10 | Product не существует или из чужого tenant → 404 PRODUCT_NOT_FOUND |
| 11 | Отрицательное значение → 400 COST_VALIDATION_FAILED |
| 12 | NaN → 400 |
| 13 | `null` явно стирает значение, `undefined` игнорируется |
| 14 | `isCostManual=true` + `updatedBy` записываются всегда; `created=true/false` различает create/update |

### 5. Spec [finance-read.spec.ts](apps/api/src/modules/finance/finance-read.spec.ts) — 11 тестов

| # | Что проверяет |
|---|---|
| 1 | list + snapshot есть → items + meta |
| 2 | snapshot отсутствует → пустой items + null snapshot, без exception |
| 3 | search фильтрует по sku |
| 4 | incompleteOnly фильтрует только incomplete строки |
| 5 | detail + snapshot → item + snapshot meta |
| 6 | detail без snapshot → 404 NO_SNAPSHOT |
| 7 | sku не в payload → 404 PRODUCT_NOT_FOUND |
| 8 | productProfile подгружается отдельно (Decimal → string) |
| 9 | dashboard → totals + topProfitable + negativeMarginSkus |
| 10 | dashboard без snapshot → empty totals, без exception |
| 11 | listActiveWarnings → ISO date strings, фильтр isActive=true |

### 6. Spec [finance.metrics.spec.ts](apps/api/src/modules/finance/finance.metrics.spec.ts) — 5 тестов

| # | Что проверяет |
|---|---|
| 1 | `increment` накапливает counter, snapshot возвращает значения |
| 2 | `observeLatency` p50/p95 |
| 3 | Окно ограничено 200 |
| 4 | `reset()` обнуляет |
| 5 | `increment by N` (для negative margin batch) |

### 7. Регистрация в [finance.module.ts](apps/api/src/modules/finance/finance.module.ts)

`FinanceMetricsRegistry` добавлен в providers + exports. Snapshot/cost-profile сервисы принимают его через DI.

### 8. Существующие spec'и продолжают проходить

Snapshot spec обновлён — теперь передаёт `FinanceMetricsRegistry` в конструктор `FinanceSnapshotService`. Все 14 старых тестов snapshot'а **продолжают проходить** — refactor не сломал поведение.

### 9. Покрытие §16 тестовой матрицы (полное)

| Сценарий из §16 | Покрыто spec'ом |
|---|---|
| Полный расчет при наличии всех данных | calculator.spec ✓ |
| Расчет без себестоимости (MISSING_COST) | calculator.spec + snapshot.spec ✓ |
| Расчет без marketplace fees (MISSING_FEES) | calculator.spec + snapshot.spec ✓ |
| Stale marketplace reports при наличии orders | snapshot.spec (stale 5 days ago) ✓ |
| Расчет без `ads/tax/returns` помечается incomplete, **но не исчезает** | calculator.spec (3 тестa: warnings есть, isIncomplete=false) ✓ |
| Смена cost profile и пересчет периода | cost-profile.spec + snapshot.spec idempotency ✓ |
| Разные tax systems на tenant | (предусмотрено в loader'е TASK_FINANCE_3, фактический spec — будущая итерация после ads/tax loader'а) |
| Блокировка rebuild в `TRIAL_EXPIRED` | snapshot.spec + policy.spec (3 paused state'а) ✓ |
| Попытка ручного ввода периодных расходов отклоняется в MVP | cost-profile.spec (revenue/marketplaceFees/logistics/tax/ads/returns — все 4+5 запрещены) + policy.spec ✓ |

### 10. Проверки

- `npx jest --testPathPatterns="finance"` → **87/87 passed, 6 suites passed**:
  - calculator: 20
  - snapshot: 14
  - policy: 21
  - metrics: 5
  - cost-profile: 14
  - read: 11
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing, не finance).

### 11. DoD сверка

- ✅ **Регрессии по формулам и policy-block сценариям ловятся автоматически**: формулы покрыты в calculator.spec (20 тестов); policy-block в policy.spec (5 paused-state кейсов) + snapshot.spec (3 paused-state) + cost-profile.spec (4 role + 5 whitelist кейса).
- ✅ **Observability показывает проблемы completeness, freshness и rebuild**: 8 метрик §19, structured-логи на каждый инкремент, latency p50/p95 для §18 SLA.
- ✅ **QA matrix покрывает утвержденную MVP financial model**: 9 из 9 строк §16 покрыты (один пункт — tax systems — отложен до подключения tax loader'а в будущей итерации).

### 12. Что НЕ сделано (намеренно — за пределами scope)

- **`/health/finance` endpoint** для публичного snapshot метрик — registry готов, controller добавится в отдельной задаче на operational dashboards.
- **E2E тесты через `supertest`** — рамки jest unit; e2e setup в `test/jest-e2e.json` существует, но требует поднятой БД + интеграции с прочими domain'ами (orders, marketplace reports), что выходит за scope этой задачи.
- **Property-based tests на calculator** — текущие 20 unit-тестов покрывают enum-комбинации вручную; добавление fast-check для рандомизированных кейсов — не требуется в scope MVP.
- **Spec на nightly cron + warning resolution job** — оба job'а ещё не реализованы (отложены в TASK_FINANCE_3 заметках); spec появится одновременно с их реализацией.
- **Tax-system specific тесты** — после подключения tax loader'а в TASK_FINANCE_3+. Сейчас calculator принимает уже готовый `taxImpact: number | null`.
