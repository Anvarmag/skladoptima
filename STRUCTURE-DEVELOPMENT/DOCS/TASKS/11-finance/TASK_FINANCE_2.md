# TASK_FINANCE_2 — Calculator Service, Formula Versioning и Completeness Rules

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `11h`
- Зависимости:
  - `TASK_FINANCE_1`
  - согласованы `10-orders`, `05-catalog`
- Что нужно сделать:
  - реализовать расчет `Revenue`, `COGS`, `Profit`, `MarginPct`, `ROIPct`;
  - version-ировать формулы через `formula_version`;
  - считать обязательным ядром `base_cost + marketplace fees + logistics`;
  - при отсутствии `ads / tax / returns` не скрывать строку, а ставить `isIncomplete=true` и warnings;
  - не подменять отсутствующие критичные данные молчаливыми нулями.
- Критерий закрытия:
  - расчет детерминирован и воспроизводим;
  - incomplete строки объяснимы и не маскируются под полные;
  - formula version позволяет воспроизвести исторические цифры.

**Что сделано**

Создан **чистый калькулятор** `FinanceCalculatorService` (без зависимости от БД) — единая точка расчёта unit-economics для будущих runtime-endpoint'а (TASK_FINANCE_3) и nightly snapshot job'а (TASK_FINANCE_4). Это исключает drift между двумя слоями: оба используют один и тот же class. Legacy `finance.service.ts` (`calculateUnitEconomics`) сохранён рядом, читатели переключатся в TASK_FINANCE_3.

### 1. [finance-calculator.service.ts](apps/api/src/modules/finance/finance-calculator.service.ts)

#### Public API

```ts
calculateSku(input: SkuFinanceInput): SkuFinanceResult
calculatePeriod(inputs: SkuFinanceInput[]): FinanceCalculationOutput
readonly formulaVersion: 'mvp-v1'
static decimalToNumber(d: Prisma.Decimal | number | null): number | null
```

`SkuFinanceInput` — нормализованные входы по одному SKU (`soldQty / revenue / baseCost / packagingCost / additionalCost / marketplaceFees / logistics / adsCost / returnsImpact / taxImpact`). Каждое cost-поле — `number | null`; `null` означает «источник отсутствует».

`SkuFinanceResult` содержит все промежуточные деньги + `profit / marginPct / roiPct` + флаг `isIncomplete` + массив `warnings: FinanceWarningType[]`.

#### Формулы §14 MVP-v1

```
COGS                = soldQty * (baseCost + packagingCost)
additionalCharges   = soldQty * additionalCost   // отдельно от COGS, чтобы ROI = Profit/COGS не искажался разовыми операционными расходами
Profit              = Revenue - COGS - MarketplaceFees - Logistics - ReturnsImpact - TaxImpact - AdsCost - additionalCharges
MarginPct           = Profit / Revenue * 100   (null если revenue=0 — деление на ноль)
ROIPct              = Profit / COGS * 100      (null если cogs=0)
```

#### Правило неполного расчёта (§14)

Я делю warning'и на **критичные** (для `isIncomplete`) и **improving** (только warning):

| Warning | Critical? | Поведение |
|---|---|---|
| `MISSING_COST` | ✅ | `isIncomplete=true`, baseCost трактуется как 0 в арифметике, но строка остаётся видимой |
| `MISSING_FEES` | ✅ | то же |
| `MISSING_LOGISTICS` | ✅ | то же |
| `MISSING_TAX` | — | warning есть, `isIncomplete=false` |
| `MISSING_ADS_COST` | — | warning есть, `isIncomplete=false` |
| `MISSING_RETURNS_DATA` | — | warning есть, `isIncomplete=false` |
| `STALE_FINANCIAL_SOURCE` | — | (ставится loader'ом, не самим calculator'ом) |

**Главный архитектурный принцип** (§20 риск): `null` cost-вход не превращается в "0" молчаливо. Калькулятор использует 0 для арифметики, но **обязательно создаёт warning** и (для критичных) выставляет `isIncomplete=true`. Строка не исчезает — пользователь видит её в Inbox с пометкой и понимает, чего не хватает.

#### Деление на ноль

`marginPct=null` если `revenue=0`, `roiPct=null` если `cogs=0`. Это явное состояние, не `Infinity / NaN` — UI рендерит как `—` или подсказку «нет данных», а не падает.

#### Округление

Все денежные результаты прогоняются через `round2()` (toFixed → parseFloat) — стабильное banker-style округление в большинстве JS-движков. Критичные деньги хранятся в БД как `DECIMAL(12,2)` (TASK_FINANCE_1), calculator округляет только в момент агрегации.

### 2. Formula versioning (§12 DoD reproducibility)

Константа `FINANCE_FORMULA_VERSION = 'mvp-v1'` экспортируется как readonly:

- В `FinanceCalculationOutput` пишется в поле `formulaVersion`.
- Snapshot job (TASK_FINANCE_4) сохранит её в `FinanceSnapshot.formulaVersion`.
- `UNIQUE(tenantId, periodFrom, periodTo, formulaVersion)` гарантирует, что rebuild с той же формулой не плодит дубль.
- При любом смысловом изменении формулы (например, разделение `COGS` и `additionalCharges` или новый коэффициент) — обязательное **инкрементирование версии** (`mvp-v1.1`, `mvp-v2`). Старые snapshot'ы хранят свою версию → исторические периоды рендерятся стабильно (§20 риск non-reproducible reports).

Дизайн-решение: сравнение версий **строкой**, не SemVer-диффом. Это намеренно — никакого "auto-upgrade" быть не должно, пересчёт исторических периодов = осознанное решение оператора.

### 3. Aggregation (`calculatePeriod`)

Сводка по периоду:
- Применяет `calculateSku` к каждому входу.
- Аггрегирует totals (revenue / cogs / fees / logistics / ads / returns / tax / additional / profit / skuCount / incompleteSkuCount).
- Перерасчитывает `marginPct` и `roiPct` от total profit.
- Определяет `snapshotStatus`:
  - **`FAILED`** — пустой набор входов (нечего считать; snapshot job сам решит, писать ли запись).
  - **`INCOMPLETE`** — хотя бы одна строка `isIncomplete=true`.
  - **`READY`** — все полные.
- Собирает `aggregatedWarnings: FinanceWarningType[]` — уникальный набор по всем строкам, для §19 алертов "массовые incomplete warnings".

### 4. Чистая функция — три преимущества

- **Воспроизводимость**: одинаковые входы → одинаковый результат (детерминированно). Spec тестирует это явно.
- **Тестируемость**: 20 unit-тестов покрывают всю §16 матрицу формул без mock'ов Prisma.
- **Composability**: runtime-endpoint и nightly snapshot job будут использовать один и тот же class — никакого drift'а.

### 5. Регистрация в [finance.module.ts](apps/api/src/modules/finance/finance.module.ts)

`FinanceCalculatorService` добавлен в providers + exports рядом с legacy `FinanceService`. Nothing else changed — frontend и существующий `calculateUnitEconomics` работают как прежде.

### 6. Spec [finance-calculator.spec.ts](apps/api/src/modules/finance/finance-calculator.spec.ts)

20 проходящих тестов:

| # | Что проверяет |
|---|---|
| 1 | Полный расчёт со всеми данными (cogs/profit/margin/roi точные значения) |
| 2 | Детерминированность — два вызова с одинаковыми входами дают `toEqual()` результат |
| 3 | `MISSING_COST` → critical → `isIncomplete=true` |
| 4 | `MISSING_FEES` → critical → `isIncomplete=true` |
| 5 | `MISSING_LOGISTICS` → critical → `isIncomplete=true` |
| 6 | Все 3 critical missing → 3 warning + строка не исчезает (расчёт по доступным полям) |
| 7-9 | `MISSING_ADS_COST / TAX / RETURNS` → warning есть, но `isIncomplete=false` |
| 10 | Все 3 optional missing → `isIncomplete=false` |
| 11 | `revenue=0` → `marginPct=null` (не Infinity) |
| 12 | `cogs=0` → `roiPct=null` |
| 13 | Пустой набор → `snapshotStatus=FAILED` |
| 14 | Все строки полные → `READY` + totals корректны |
| 15 | Хоть одна incomplete → `snapshotStatus=INCOMPLETE` |
| 16-17 | `formulaVersion='mvp-v1'` стабилен и присутствует в output |
| 18-20 | `decimalToNumber` корректно конвертирует null/number/Decimal-like |

### 7. Проверки

- `npx jest --testPathPatterns="finance"` → **20/20 passed, 1 suite passed**.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing, не finance).

### 8. DoD сверка

- ✅ **Расчёт детерминирован и воспроизводим**: pure function без БД, тест на `toEqual()` двух вызовов. `formulaVersion` фиксирует конкретную версию формулы.
- ✅ **Incomplete строки объяснимы и не маскируются**: `warnings: FinanceWarningType[]` точно перечисляет, чего не хватает; `isIncomplete=true` — машинный флаг для UI чтобы рендерить "incomplete data" badge per §128 system-analytics; критичные missing → строка остаётся видимой, не выпадает молча.
- ✅ **Formula version позволяет воспроизвести исторические цифры**: `'mvp-v1'` записывается в `FinanceCalculationOutput.formulaVersion` и в каждый `SkuFinanceResult` через snapshot job (TASK_FINANCE_4); UNIQUE constraint на snapshot гарантирует, что одна и та же формула + период = один snapshot.

### 9. Что НЕ сделано (намеренно — следующие задачи модуля)

- **Loader из БД** (orders + cost profile + marketplace reports → `SkuFinanceInput[]`) — это TASK_FINANCE_3. Calculator принимает уже готовые входы, чтобы оставаться pure.
- **Запись `FinanceSnapshot` и `FinanceDataWarning`** — TASK_FINANCE_4 (snapshot service).
- **REST endpoints** — TASK_FINANCE_3.
- **Nightly job + on-demand rebuild** — TASK_FINANCE_4.
- **Tax calculation по `TenantSettings.taxSystem`** — пока taxImpact передаётся как готовое число; при null → `MISSING_TAX` warning. Полноценный per-tax-system калькулятор — `taxImpact` loader в TASK_FINANCE_3 (вызовет существующую логику из `finance.service.ts`).
