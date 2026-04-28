# TASK_FINANCE_1 — Data Model, Cost Profiles и Warnings

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `11-finance`
  - согласованы `05-catalog`, `10-orders`
- Что нужно сделать:
  - завести таблицы `product_finance_profiles`, `finance_snapshots`, `finance_data_warnings`;
  - закрепить manual input только для `base_cost`, `packaging_cost`, `additional_cost`;
  - описать warning types для missing cost, fees, logistics, tax, ads, returns и stale source;
  - предусмотреть `formula_version`, `snapshot_status`, `source_freshness`, `generated_at/by`;
  - согласовать модель с catalog products и normalized orders.
- Критерий закрытия:
  - data model покрывает cost profiles, snapshots и warning layer;
  - ручной ввод периодных расходов не поддерживается в MVP;
  - модель пригодна для воспроизводимого read-model расчета.

**Что сделано**

Доменная модель finance заведена параллельно legacy-полям `Product.purchasePrice / minPrice / commissionRate / logisticsCost`, которые ещё использует существующий `finance.service.ts` (calculateUnitEconomics в realtime). Переключение читателей на новый профиль — следующая задача модуля. Никаких существующих таблиц не модифицировано — добавление аддитивное.

### 1. Три новых enum в [schema.prisma](apps/api/prisma/schema.prisma)

- **`FinanceSnapshotPeriodType`** — `WEEK / MONTH / CUSTOM`. Детерминированные календарные окна для nightly job'а + произвольный from/to для on-demand rebuild owner/admin'а (§4 сценарий 2).
- **`FinanceSnapshotStatus`** — `READY / INCOMPLETE / FAILED`. **`INCOMPLETE` отделён от `READY` и `FAILED` сознательно** — расчёт прошёл, но критичные source отсутствуют. UI показывает данные с warning'ом, а не молчаливыми нулями (§14 правило неполного расчёта + §20 риск).
- **`FinanceWarningType`** — `MISSING_COST / MISSING_FEES / MISSING_LOGISTICS / MISSING_TAX / MISSING_ADS_COST / MISSING_RETURNS_DATA / STALE_FINANCIAL_SOURCE`. Стабильный enum для UI рендера и фильтрации `/api/v1/finance/warnings?type=...` (TASK_FINANCE_3).

### 2. Таблица `ProductFinanceProfile`

Manual cost input на уровне SKU. Manual в MVP **разрешён только для трёх полей** (§10 + §13 + §20 риск):
- `baseCost`, `packagingCost`, `additionalCost` — все `DECIMAL(12,2)` (точные деньги без float-дрифта).
- `costCurrency VARCHAR(3) DEFAULT 'RUB'`, `isCostManual BOOLEAN DEFAULT true` — флаг manual против автомата (нужен будущему pipeline'у TASK_FINANCE_2/3, чтобы не перетирать ручное значение).
- `updatedBy` (FK User SET NULL) — audit пользователя, который менял.
- **`UNIQUE(productId)`** — один профиль на товар; в схеме как `@unique` на поле + дополнительный composite-индекс `(tenantId, productId)` для list-API.

**FK-политика:** `tenant CASCADE` (закрытие → очистка); `product CASCADE` (удаление товара → профиль осиротеет, чистим); `updatedBy SET NULL` (soft-deleted user не должен ломать историю).

### 3. Таблица `FinanceSnapshot`

Снапшот периода с агрегированным `payload JSONB` (per-SKU цифры + сводные KPI) и `formulaVersion VARCHAR(32)`. Это **главный механизм воспроизводимости** §12 DoD: если поменяли формулу, старые snapshot'ы хранят свою версию, исторические периоды рендерятся стабильно (§20 риск non-reproducible reports).

- `periodFrom/periodTo DATE`, `periodType`, `formulaVersion`, `snapshotStatus DEFAULT READY`.
- `payload JSONB NOT NULL` — агрегаты + per-SKU breakdown.
- `sourceFreshness JSONB NULL` — diagnostics: `{ orders: { lastEventAt, isStale }, fees: {...}, ads: {...} }` для §14 правила stale snapshot.
- `generatedAt`, `generatedBy User? SET NULL`.

**Идемпотентность rebuild** — `UNIQUE(tenantId, periodFrom, periodTo, formulaVersion)`. Повторный rebuild того же периода с той же формулой не создаёт дубль; новая формула версионирует snapshot отдельно. Дополнительные индексы: `(tenantId, periodTo, generatedAt)` для UI-списка и `(tenantId, snapshotStatus, generatedAt)` для §19 health board.

### 4. Таблица `FinanceDataWarning`

Append-only журнал предупреждений. Дизайн:
- `productId` опционален: warning может быть per-SKU (`MISSING_COST`) или tenant-wide (`STALE_FINANCIAL_SOURCE` без конкретного товара).
- `snapshotId` опционален: realtime-расчёт без snapshot'а тоже может вернуть warning'и для UI.
- `isActive BOOLEAN DEFAULT true` + `resolvedAt TIMESTAMPTZ NULL` — warning resolution job (§15) выставляет `isActive=false` после появления данных. **Физически warning не удаляется** — аналитика должна видеть исторические incomplete-периоды.
- `details JSONB` — контекст: `{ missingComponents: [...], lastReliableAt }` и т.п.

**FK-политика:** `tenant CASCADE`; `product SET NULL` (soft-delete товара сохраняет warning); `snapshot CASCADE` (удаление snapshot чистит свои warning'и). Индексы под §19 dashboards: `(tenantId, isActive, warningType)`, `(tenantId, productId)`, `(snapshotId)`.

### 5. Обратные relations

Добавлены в существующие модели без изменения их остальных полей:
- `Tenant`: `productFinanceProfiles[]`, `financeSnapshots[]`, `financeDataWarnings[]`.
- `User`: `updatedFinanceProfiles[] @relation("FinanceProfileUpdatedBy")`, `generatedFinanceSnapshots[] @relation("FinanceSnapshotGeneratedBy")`.
- `Product`: `financeProfile ProductFinanceProfile?` (1:1) + `financeWarnings[]`.

### 6. Миграция [20260428000000_finance_data_model/migration.sql](apps/api/prisma/migrations/20260428000000_finance_data_model/migration.sql)

DDL полностью повторяет prisma schema:
- 3 `CREATE TYPE` для enum'ов.
- 3 `CREATE TABLE` + 9 `ALTER TABLE ADD CONSTRAINT FOREIGN KEY` (с правильными `ON DELETE CASCADE / SET NULL`).
- 9 индексов (1 PK на каждой таблице + UNIQUE на `productId` для профиля + UNIQUE для idempotency snapshot + 6 диагностических).
- Подробные комментарии в шапке: что делает, что НЕ делает (legacy `Product.*Cost` не трогаем; periodic charges / nightly job / REST endpoints — TASK_FINANCE_2..5).

### 7. Что **намеренно НЕ сделано** (зафиксировано в комментариях миграции)

- **Не трогаем legacy `Product.purchasePrice / minPrice / commissionRate / logisticsCost`** — текущий `finance.service.ts` MVP их использует. Переключение читателей на `ProductFinanceProfile` — TASK_FINANCE_2/3.
- **Не создаём `period_marketplace_charges` или manual periodic expenses** — §13 + §20 риск, в MVP запрещено.
- **Не создаём REST endpoints** `/api/v1/finance/products/:id/cost`, `/snapshots/rebuild`, `/snapshots/status` — это TASK_FINANCE_3/4.
- **Не реализуем runtime calculator + nightly snapshot job** — TASK_FINANCE_2/4.
- **Не трогаем frontend** `UnitEconomics.tsx` — переключение на новые endpoints в TASK_FINANCE_5+.

### 8. Проверки

- `npx prisma validate` → schema valid.
- `npx prisma generate` → клиент сгенерирован, типы `ProductFinanceProfile / FinanceSnapshot / FinanceDataWarning / FinanceSnapshotPeriodType / FinanceSnapshotStatus / FinanceWarningType` доступны.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing, никаких новых от finance изменений). Grep по `finance|FinanceProfile|FinanceSnapshot|FinanceWarning` → 0 матчей в TS-ошибках.

### 9. DoD сверка

- ✅ **Data model покрывает cost profiles, snapshots и warning layer**: 3 таблицы, 3 enum'а, 9 диагностических индексов покрывают все §6 endpoints (даже те, что появятся в TASK_FINANCE_3+).
- ✅ **Ручной ввод периодных расходов не поддерживается в MVP**: в `ProductFinanceProfile` есть только `baseCost / packagingCost / additionalCost` — никаких period-level колонок. Никакой таблицы под manual periodic expenses не заведено.
- ✅ **Модель пригодна для воспроизводимого read-model расчёта**: `FinanceSnapshot.formulaVersion` + `UNIQUE(tenant, period, formulaVersion)` идемпотентность + `payload JSONB` хранит финальные цифры; `sourceFreshness` фиксирует диагностику источников.
