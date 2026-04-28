# TASK_FINANCE_5 — Tenant-State Guards, Source-of-Truth Policy и Stale Handling

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_FINANCE_2`
  - `TASK_FINANCE_3`
  - согласованы `02-tenant`, `08-marketplace-accounts`, `09-sync`
- Что нужно сделать:
  - заблокировать rebuild при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - оставить finance snapshots доступными для чтения при paused tenant;
  - закрепить source-of-truth policy: revenue/sold_qty только из `orders`, fees/logistics только из finance feeds, manual input только в product profile;
  - различать stale state по источникам и incomplete state по missing components;
  - синхронизировать поведение finance с analytics и billing/access policy.
- Критерий закрытия:
  - finance не тянет новые внешние данные в обход tenant policy;
  - source-of-truth policy однозначна и не допускает ручной подмены revenue/fees;
  - stale и incomplete не смешиваются в runtime semantics.

**Что сделано**

Создан **централизованный `FinancePolicyService`** — единая точка enforcement'а tenant guards, source-of-truth contract'а и stale/incomplete classification. Раньше эти проверки были разбросаны по `FinanceSnapshotService` (tenant guard), `FinanceCostProfileService` (manual whitelist на уровне DTO) и комментариям в loader'е. Теперь — **single source of truth**, регрессионно защищённый spec'ом.

### 1. [finance-policy.service.ts](apps/api/src/modules/finance/finance-policy.service.ts)

#### Public API

```ts
assertRebuildAllowed(tenantId): Promise<AccessState>          // 403 при paused
isReadAllowed(tenantId): Promise<boolean>                     // true даже при CLOSED
assertManualCostInputAllowed(field): asserts field is ManualCostField  // 403 при попытке bypass
evaluateStaleness({ sourceFreshness, snapshotStatus }): SnapshotFreshnessVerdict
```

#### Константы как enforced-документация

```ts
MANUAL_COST_FIELDS_WHITELIST = ['baseCost', 'packagingCost', 'additionalCost', 'costCurrency'] as const;
FINANCE_SOURCE_OF_TRUTH = { revenue: '...', soldQty: '...', marketplaceFees: '...', /* 10 fields */ };
STALE_SOURCE_WINDOW_HOURS = 48;
```

`MANUAL_COST_FIELDS_WHITELIST` — **load-bearing** константа. Любая попытка расширить whitelist (например, добавить `marketplaceFees`) сразу падает на `regression invariants` тесте — это намеренно, расширение whitelist должно проходить через явный design-review.

`FINANCE_SOURCE_OF_TRUTH` — словарь "поле → источник", документирующий §13 правило в коде. Используется и UI (для подсказок «откуда эти данные»), и тестами (что loader не подключился к "не той" таблице).

#### Stale vs Incomplete classification (§14 + §128)

`evaluateStaleness()` возвращает **explicit four-state classification**:

| classification | sourceFreshness.isStale | snapshotStatus | UX поведение |
|---|---|---|---|
| `FRESH_AND_COMPLETE` | false | READY | показать без disclaimers |
| `STALE_BUT_COMPLETE` | true | READY | "данные могут быть устаревшими, freshness: ..." |
| `INCOMPLETE_BUT_FRESH` | false | INCOMPLETE | "недостаёт критичных компонентов" + warning list |
| `STALE_AND_INCOMPLETE` | true | INCOMPLETE | оба disclaimers (худший случай) |

UI и API теперь могут рендерить разные предупреждения для разных кейсов — это §128 ("UI должен различать `incomplete data` и `stale snapshot`: это разные причины недоверия к цифре") в коде.

#### PAUSED_TENANT_STATES

Set из `TRIAL_EXPIRED / SUSPENDED / CLOSED`. **Намеренно дублирует** аналогичную константу в `SyncPreflightService` — finance это purely internal операция, не должна транзитивно зависеть от sync-preflight семантики (которая сосредоточена на marketplace API guard'ах). Если в будущем `02-tenant` модуль предоставит общий enum-helper "isWriteBlocked(state)" — мигрируем оба сервиса на него.

### 2. Refactor: snapshot service использует политику

#### [finance-snapshot.service.ts](apps/api/src/modules/finance/finance-snapshot.service.ts)

- Удалена локальная `PAUSED_TENANT_STATES` константа.
- `STALE_SOURCE_WINDOW_HOURS` теперь импортируется из `finance-policy.service`.
- Ручная проверка `tenant.findUnique + accessState in paused` заменена на `await this.policy.assertRebuildAllowed(tenantId)`.
- Сервис больше не дублирует policy-логику — снапшот просто обращается к политике и продолжает работу. Если поведение надо поменять — меняем в одном месте (`FinancePolicyService`).

#### [finance-cost-profile.service.ts](apps/api/src/modules/finance/finance-cost-profile.service.ts)

Добавлен **runtime-enforcement** whitelist в начало `updateProductCost`:

```ts
for (const key of Object.keys(args.input)) {
    if (args.input[key] === undefined) continue;
    this.policy.assertManualCostInputAllowed(key);
}
```

DTO (`UpdateProductCostDto`) уже отсекал большинство через `ValidationPipe`, но runtime-проверка важна на случай **прямого вызова сервиса**: например, из cron job'а, другого NestJS-модуля, теста, или если кто-то выключил `whitelist: true` в global ValidationPipe. Defense in depth.

### 3. Synchronization с analytics/billing access policy

- `PAUSED_TENANT_STATES` сейчас дублирует `SyncPreflightService.PAUSED_TENANT_STATES` 1:1 — оба используют официальный enum `AccessState` из Prisma. Если billing/analytics завтра захотят свою policy — они ссылаются на тот же enum, и не будет drift'а.
- Все три модуля (sync / finance / orders) **отдельно** проверяют policy и **не делятся** state'ом друг с другом — каждый домен принимает решение сам, на основании актуального tenant.accessState. Это §20 риск ("если разрешить finance rebuild напрямую дёргать внешние интеграции, модуль начнёт нарушать уже согласованные tenant/account runtime guards") в виде архитектурного контракта: finance не вызывает sync, sync не вызывает finance, оба независимо проверяют tenant state.

### 4. Spec [finance-policy.spec.ts](apps/api/src/modules/finance/finance-policy.spec.ts) — 21 тест

| # | Что проверяет |
|---|---|
| 1 | Активные tenant states (TRIAL_ACTIVE/ACTIVE_PAID/EARLY_ACCESS/GRACE_PERIOD) пропускают rebuild |
| 2-4 | TRIAL_EXPIRED / SUSPENDED / CLOSED → ForbiddenException |
| 5 | Tenant не существует → ForbiddenException |
| 6-7 | Read доступен при TRIAL_EXPIRED и CLOSED (§4 read-only история) |
| 8 | Несуществующий tenant → `isReadAllowed=false` без exception |
| 9 | Whitelist разрешает baseCost / packagingCost / additionalCost / costCurrency |
| 10 | revenue → ForbiddenException MANUAL_INPUT_NOT_ALLOWED |
| 11 | marketplaceFees → ForbiddenException (нельзя подменять marketplace fees вручную) |
| 12 | logistics / soldQty / adsCost / taxImpact / returnsImpact — все запрещены |
| 13 | Произвольное unknown поле → ForbiddenException |
| 14 | `FRESH_AND_COMPLETE` classification |
| 15 | `STALE_BUT_COMPLETE` — fees stale, status READY |
| 16 | `INCOMPLETE_BUT_FRESH` |
| 17 | `STALE_AND_INCOMPLETE` |
| 18 | null sourceFreshness → не stale |
| 19 | **Regression**: `MANUAL_COST_FIELDS_WHITELIST` не должен расширяться без code review (явный `toEqual()` на содержимое) |
| 20 | `FINANCE_SOURCE_OF_TRUTH` перечисляет все 10 обязательных категорий |
| 21 | `STALE_SOURCE_WINDOW_HOURS = 48` (§14 константа) |

### 5. Регистрация в [finance.module.ts](apps/api/src/modules/finance/finance.module.ts)

`FinancePolicyService` добавлен в providers + exports. Snapshot/cost-profile сервисы теперь принимают его через DI.

### 6. Проверки

- `npx jest --testPathPatterns="finance"` → **55/55 passed, 3 suites passed** (20 calculator + 14 snapshot + 21 policy).
  - Snapshot spec'и продолжают проходить — refactor не сломал поведение, просто перенёс проверку в `FinancePolicyService.assertRebuildAllowed`.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing, не finance).

### 7. DoD сверка

- ✅ **Finance не тянет новые внешние данные в обход tenant policy**: `assertRebuildAllowed` → `403 FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE` для PAUSED states. Loader (TASK_FINANCE_3) читает только из internal таблиц (Order/OrderItem/ProductFinanceProfile/MarketplaceReport) — никаких axios/sync вызовов в `FinanceSnapshotService`.
- ✅ **Source-of-truth policy однозначна и не допускает ручной подмены revenue/fees**: `MANUAL_COST_FIELDS_WHITELIST` ограничен 4 полями (3 cost + currency); runtime-enforcement в cost-profile сервисе + DTO whitelist + regression spec на содержимое константы.
- ✅ **Stale и incomplete не смешиваются в runtime semantics**: `evaluateStaleness()` отдаёт **discrete classification** из 4 состояний; `STALE_FINANCIAL_SOURCE` warning отдельно от `MISSING_COST/FEES/LOGISTICS`; `snapshotStatus=READY` для stale-but-complete, `INCOMPLETE` только для missing critical.

### 8. Что НЕ сделано (намеренно — следующие задачи модуля)

- **Frontend UnitEconomics rewrite** — TASK_FINANCE_6 (по аналогии с Orders.tsx из TASK_ORDERS_6). UI будет рендерить `evaluateStaleness().classification` как 4 разных badge'а.
- **Nightly cron job** для autosnapshot + warning resolution — TASK_FINANCE_6 или отдельная итерация после интеграции с `18-worker`.
- **Shared `02-tenant` access-policy helper** — сейчас `PAUSED_TENANT_STATES` дублируется в finance/sync. Унификация — отдельная задача в roadmap'е `02-tenant`.
- **`FinanceReadService` integration с policy** — read-методы пока не дёргают `isReadAllowed` явно (потому что `RequireActiveTenantGuard` уже отбивает несуществующих tenant'ов на entry-point'е). Полное покрытие read-policy hook'ами — нужно когда появится post-retention CLOSED, который скрывает данные, а не показывает.
- **Audit log в `15-audit`** для `MANUAL_INPUT_NOT_ALLOWED` событий — пока только structured warn-лог, в TASK_FINANCE_6 подключим к audit-таблице.
