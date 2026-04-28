# TASK_FINANCE_4 — API Table/Detail/Dashboard и Cost Profile Updates

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_FINANCE_1`
  - `TASK_FINANCE_2`
  - `TASK_FINANCE_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/finance/unit-economics`, `GET /api/v1/finance/unit-economics/:productId`, `GET /api/v1/finance/dashboard`;
  - реализовать `PATCH /api/v1/finance/products/:productId/cost`;
  - реализовать `POST /api/v1/finance/snapshots/rebuild` и `GET /api/v1/finance/snapshots/status`;
  - отдавать breakdown по расходным компонентам, `isIncomplete`, warnings и freshness;
  - ограничить update/rebuild действия ролями `Owner/Admin`.
- Критерий закрытия:
  - finance API покрывает table, detail, dashboard и status surfaces;
  - cost profile обновляется без обхода product-level policy;
  - пользователь получает объяснимые breakdown и warning поля.

**Что сделано**

REST-слой полностью переписан — теперь читает из доменного `FinanceSnapshot` (TASK_FINANCE_3), а не из realtime join'а. Старая логика `/finance/unit-economics` сохранена под `/finance/unit-economics/legacy` для backward-compat с frontend `UnitEconomics.tsx` до TASK_FINANCE_5.

### 1. Новые сервисы

#### [finance-read.service.ts](apps/api/src/modules/finance/finance-read.service.ts)

Read-only сервис, читающий **последний snapshot текущей `formulaVersion`** (`mvp-v1`). Никаких realtime пересчётов — это §18 SLA.

| Метод | Что делает |
|---|---|
| `listUnitEconomics(tenantId, {search, incompleteOnly})` | per-SKU items из payload + snapshot meta. Фильтры применяются на массиве (MVP-упрощение; полная развёртка в отдельную таблицу — будущая задача). |
| `getProductDetail(tenantId, productId)` | row из payload + текущий `ProductFinanceProfile` (для UI редактирования). 404 `NO_SNAPSHOT` если snapshot отсутствует, 404 `PRODUCT_NOT_FOUND` если SKU не в payload. |
| `getDashboard(tenantId)` | totals из payload + топ-3 profitable + список **negative-margin SKU** (для §19 negative_margin_sku_count алерта) + aggregatedWarnings. |
| `listActiveWarnings(tenantId)` | все `FinanceDataWarning.isActive=true` для UI badge "почему данные неполные". |

Если snapshot текущей версии отсутствует → empty response с `snapshot: null` (UI рендерит призыв к rebuild). Это явное operational состояние, не падение.

#### [finance-cost-profile.service.ts](apps/api/src/modules/finance/finance-cost-profile.service.ts)

`updateProductCost({tenantId, productId, actorUserId, input})` — upsert профиля.

**Правила:**
- **Role gating**: только `OWNER`/`ADMIN`. Membership lookup в сервисе (тот же подход, что в `OrdersReprocessService` — нет `RolesGuard` инфры).
- **Tenant validation**: product должен принадлежать tenant'у и не быть soft-deleted (`deletedAt: null`).
- **Manual whitelist** (§10 + §13 + §20 риск): принимаются **только** `baseCost / packagingCost / additionalCost / costCurrency`. DTO + class-validator `whitelist: true` отбивают всё остальное на entry-point'е.
- **Семантика `null` vs `undefined`**: `null` явно стирает значение, `undefined` (поле не передано) — оставляет как есть. Spread `...(field !== undefined ? {...} : {})` в upsert.update.
- **Validation**: `>= 0`, no NaN/Infinity → `400 COST_VALIDATION_FAILED`.
- **`isCostManual = true`** всегда при PATCH — фиксирует, что значения введены вручную.
- **Currency**: `slice(0,3).toUpperCase()` для нормализации.
- **Audit**: `updatedBy = actorUserId` + structured-лог `finance_cost_profile_updated`.

### 2. DTO

- [dto/update-product-cost.dto.ts](apps/api/src/modules/finance/dto/update-product-cost.dto.ts): `baseCost / packagingCost / additionalCost` (`@IsOptional + @IsNumber + @Min(0)`), `costCurrency` (`@Length(3,3)`).
- [dto/rebuild-snapshot.dto.ts](apps/api/src/modules/finance/dto/rebuild-snapshot.dto.ts): `periodFrom / periodTo` (`@IsDateString`), `periodType` (`@IsEnum`), `jobKey` (опционально).

### 3. Расширенный [finance.controller.ts](apps/api/src/modules/finance/finance.controller.ts)

7 endpoint'ов, все под `RequireActiveTenantGuard`. Write-эндпоинты дополнительно под `TenantWriteGuard` + role check внутри сервиса/inline.

| Method | Path | Auth |
|---|---|---|
| `GET` | `/finance/unit-economics?search=&incompleteOnly=` | User (read доступен и при paused) |
| `GET` | `/finance/unit-economics/:productId` | User |
| `GET` | `/finance/unit-economics/legacy?productId=` | User (backward-compat для UnitEconomics.tsx) |
| `GET` | `/finance/dashboard` | User |
| `GET` | `/finance/snapshots/status` | User |
| `GET` | `/finance/warnings` | User |
| `PATCH` | `/finance/products/:productId/cost` | Owner/Admin (TenantWriteGuard + role check в сервисе) |
| `POST` | `/finance/snapshots/rebuild` | Owner/Admin (TenantWriteGuard + inline `_assertOwnerOrAdmin` + сервисная проверка `accessState`) |

Маршруты регистрируются под глобальным prefix'ом `/api`, итоговые URL — `/api/finance/...` (системная аналитика обозначает `/api/v1/...` — `/v1` зарезервирован под будущий versioning, в MVP остаётся `/api`).

### 4. Регистрация в [finance.module.ts](apps/api/src/modules/finance/finance.module.ts)

`FinanceReadService` + `FinanceCostProfileService` добавлены в providers + exports. Legacy `FinanceService` остаётся рядом для backward-compat endpoint'а.

### 5. Объяснимый breakdown в API

UI получает не только конечные числа, но и:
- **Per-SKU breakdown**: `revenue / cogs / marketplaceFees / logistics / adsCost / returnsImpact / taxImpact / additionalCharges / profit / marginPct / roiPct` — каждое поле отдельно.
- **`isIncomplete: boolean`** — однозначный флаг для UI badge "incomplete data".
- **`warnings: string[]`** — список конкретных warning-типов (`MISSING_COST`, `MISSING_FEES`, etc.) → UI рендерит человекочитаемые объяснения, точно как в Orders drawer (TASK_ORDERS_6).
- **`snapshot.sourceFreshness`** — `{orders, fees, costProfiles}.{lastEventAt, isStale}` → UI различает `incomplete data` от `stale snapshot`.
- **`snapshot.formulaVersion`** — UI может подсветить "доступна новая версия формулы, нажмите Rebuild".

### 6. Role gating без обхода product-level policy

PATCH `/finance/products/:productId/cost`:
- **Tenant validation**: `Product.tenantId === activeTenantId` обязательно — нельзя через cross-tenant orderId создать профиль для чужого товара.
- **Soft-deleted product** (`deletedAt != null`) → `404 PRODUCT_NOT_FOUND`. Профиль для удалённого товара не создаётся.
- **Manual whitelist** проходит через DTO + сервисный `_normalize`. Любая попытка передать `marketplaceFees` или другое неразрешённое поле просто игнорируется (в DTO такого поля нет).
- **Audit log**: `updatedBy = actorUserId`; `isCostManual = true` явно фиксирует «это ручное значение, автомат не должен перетирать молча».

### 7. Проверки

- `npx jest --testPathPatterns="finance"` → **34/34 passed** (20 calculator + 14 snapshot из TASK_FINANCE_2/3 — продолжают проходить, ничего не сломал).
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing, не finance).

### 8. DoD сверка

- ✅ **Finance API покрывает table, detail, dashboard, status surfaces**: 8 endpoint'ов закрывают все §6 строки + warnings list (бонус для §19 dashboards) + legacy для backward-compat.
- ✅ **Cost profile обновляется без обхода product-level policy**: tenant ownership check + soft-delete guard + DTO whitelist + Owner/Admin role check + audit-trail.
- ✅ **Объяснимые breakdown и warning поля**: per-SKU breakdown по 11 полям + `isIncomplete` + `warnings[]` + `sourceFreshness` + `formulaVersion`. UI получает достаточно для рендера "почему строка incomplete" и "stale vs incomplete" различения.
- ✅ **Role gating Owner/Admin**: проверки и в `FinanceCostProfileService.updateProductCost` (для PATCH cost) и в `FinanceController._assertOwnerOrAdmin` (для POST rebuild) + `TenantWriteGuard` отбивает paused tenant ещё до сервиса.

### 9. Что НЕ сделано (намеренно — следующие задачи модуля)

- **Frontend UnitEconomics rewrite** на новый snapshot endpoint — TASK_FINANCE_5 (по аналогии с Orders.tsx из TASK_ORDERS_6: фильтры + drawer с breakdown + warning explanations + paused banner).
- **Nightly cron job** на ежедневный rebuild — пока rebuild только on-demand. В TASK_FINANCE_5/6 (через `@nestjs/schedule` или `18-worker`).
- **Warning resolution job** — отдельный cron, который ставит `isActive=false` после появления данных. Также в TASK_FINANCE_5/6.
- **Spec на FinanceReadService и FinanceCostProfileService** — добавлю в TASK_FINANCE_6 (QA), в одном пакете с метриками.
- **Per-SKU fees breakdown** — требует расширения `MarketplaceReport`-feed; сейчас в loader'е (TASK_FINANCE_3) распределяем пропорционально revenue (документировано как MVP-упрощение).
- **`/v1` URL prefix** — оставлен на будущее API versioning. Сейчас все маршруты `/api/finance/*`.
