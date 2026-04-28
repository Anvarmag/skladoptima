# TASK_FINANCE_6 — Frontend Unit Economics UX и Diagnostics

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_FINANCE_3`
  - `TASK_FINANCE_4`
  - `TASK_FINANCE_5`
- Что нужно сделать:
  - собрать profitability table, dashboard и SKU detail с breakdown по компонентам;
  - явно показывать `isIncomplete`, active warnings и `stale snapshot`;
  - реализовать UX для редактирования `base_cost / packaging_cost / additional_cost`;
  - блокировать rebuild actions при `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - показывать дату последнего reliable refresh и formula version там, где это критично для доверия к цифрам.
- Критерий закрытия:
  - пользователь понимает, из чего собран расчет и чего ему не хватает;
  - incomplete и stale визуально и семантически разделены;
  - UI не обещает runtime обновление там, где tenant policy его блокирует.

**Что сделано**

Полностью переписан фронт `/app/finance` (страница [UnitEconomics.tsx](apps/web/src/pages/UnitEconomics.tsx)) под доменный snapshot-driven `/api/finance` API. Старая версия дёргала legacy `/finance/unit-economics` (realtime calc по плоской модели) и обновляла `Product.purchasePrice` через `/products/:id` PUT. Новая версия читает из последнего snapshot и редактирует `ProductFinanceProfile` через `/finance/products/:id/cost` (Owner/Admin only).

### 1. Доменные TS-типы (mirror backend DTO)

Объявлены в верху файла: `FreshnessClass`, `WarningType`, `SnapshotMeta`, `UEItem`, `ListResp`, `DashboardResp`, `DetailResp`. Зеркалят выходные DTO `FinanceReadService` (TASK_FINANCE_4) — переименование enum-значения на бэке сразу подсветит TS-ошибку во фронте.

### 2. Snapshot meta + Freshness badge

Под шапкой страницы — карточка `SnapshotMetaCard` показывает:
- **Период** snapshot'а (`periodFrom → periodTo`).
- **Версия формулы** (`mvp-v1`) — критично для доверия к цифрам.
- **Сгенерирован** (timestamp).
- **Freshness badge** — один из 4 классов `FRESHNESS_BADGE` с человекочитаемым label'ом и explain'ом:
  - `FRESH_AND_COMPLETE` (emerald) — всё ок;
  - `STALE_BUT_COMPLETE` (amber) — структура полная, источники старые;
  - `INCOMPLETE_BUT_FRESH` (orange) — источники свежие, не хватает критичных компонентов;
  - `STALE_AND_INCOMPLETE` (rose) — обе оси проблемные.

Это **§128 правило** ("UI должен различать `incomplete data` и `stale snapshot`") в коде. Классификация считается на клиенте через `classifyFreshness()` хелпер — зеркало `FinancePolicyService.evaluateStaleness()` из TASK_FINANCE_5.

Если snapshot отсутствует — карточка превращается в призыв «Snapshot ещё не построен. Нажмите «Пересчитать».

### 3. Dashboard KPI tiles

6 цветных карточек: Выручка / COGS / Прибыль / Маржа / ROI / Incomplete SKU. Тон Прибыли динамически меняется emerald/rose в зависимости от знака. `Incomplete SKU` — отдельный счётчик `incompleteSkuCount / skuCount`, тон amber если есть incomplete.

### 4. Aggregated warnings секция

Список `dashboard.aggregatedWarnings` с человекочитаемыми описаниями из `WARNING_LABEL`:

| Warning | Critical? | UX |
|---|---|---|
| MISSING_COST | ✅ | rose icon, "Базовая себестоимость не введена в карточке товара" |
| MISSING_FEES | ✅ | rose icon, "Финансовый отчёт маркетплейса за период не загружен" |
| MISSING_LOGISTICS | ✅ | rose icon, "Логистические расходы из отчёта отсутствуют" |
| MISSING_TAX | — | amber icon, "Расчёт налога не выполнен. На итог влияет несильно" |
| MISSING_ADS_COST | — | amber icon, "Рекламные расходы не подгружены" |
| MISSING_RETURNS_DATA | — | amber icon, "Возвраты не учтены" |
| STALE_FINANCIAL_SOURCE | — | amber icon, "Один из источников не обновлялся более 48ч" |

Iconography: critical → `AlertTriangle` (rose), non-critical → `Info` (amber). Это перекрывает §128 + §13.

### 5. Top profitable / Negative margin SKUs

Два бок-о-бок ListBox'а:
- **Топ-3 прибыльных SKU** (TrendingUp icon, emerald) — клик открывает drawer.
- **Отрицательная прибыль (N)** (TrendingDown icon, rose) — список до 5 проблемных SKU с profit + margin %; клик открывает drawer.

§19 покрывает `negative_margin_sku_count` алерт — оператор сразу видит проблемные SKU без долгого скроллинга таблицы.

### 6. Filters + Profitability table

- **Search** по SKU (debounced через useEffect на 200мс).
- **Только incomplete** checkbox — фильтр на уровне backend (`?incompleteOnly=true`).
- Таблица 10 колонок: SKU / Кол-во / Выручка / COGS / Комиссии / Логистика / Прибыль (цвет по знаку) / Маржа / ROI / Состояние (chip `OK` или `incomplete · N warnings`).
- Click row → drawer.

### 7. Product Detail Drawer (`ProductDrawer`)

Boczная панель, открывается по клику на строку или по топ-листу. 4 секции:

#### a. Summary grid (2×3)
Sold qty / Revenue / Profit (цвет по знаку) / Margin / ROI / Period.

#### b. Breakdown расходов
Slate box с 7 строками: COGS / Комиссии / Логистика / Реклама / Возвраты / Налоги / Прочие. **Это самое главное для doверия к цифрам** — пользователь видит, из чего собран Profit.

#### c. Warnings explanation (если есть)
Amber секция с заголовком "Почему расчёт неполный" + список warning'ов с label + explain. Critical (`AlertTriangle` rose) и non-critical (`Info` amber) различаются визуально.

#### d. Cost profile editor
View mode: показывает `baseCost / packagingCost / additionalCost` + `costCurrency` + дату последнего обновления + флаг `manual/auto`.

Edit mode (только Owner/Admin — backend отдаст 403 если роль ниже):
- 3 numeric input'а только для разрешённых полей (§13 whitelist).
- Кнопка "Сохранить" → `PATCH /finance/products/:id/cost`. После успеха refetch detail + список + dashboard.
- Disclaimer внизу: «Manual input разрешён только для baseCost / packagingCost / additionalCost (см. policy §13). Marketplace fees и logistics берутся только из feed'ов».
- При paused tenant: кнопка «Редактировать» disabled с tooltip «Недоступно при паузе интеграций».

### 8. Paused banner + rebuild gating

Под шапкой при `accessState ∈ {TRIAL_EXPIRED, SUSPENDED, CLOSED}` — амбер баннер `PauseCircle`:

> «Финансовые источники на паузе. История snapshots доступна для просмотра, но пересчёт и подгрузка новых данных заблокированы политикой компании ({state}). Цифры ниже могут не отражать актуальное состояние.»

Кнопка **«Пересчитать»** → `POST /finance/snapshots/rebuild`:
- Если snapshot есть — пересчитывает текущий период (используя его `periodFrom/periodTo/periodType`).
- Если snapshot нет — собирает за последние 30 дней (`CUSTOM`).
- Disabled при `isPaused` с tooltip — UI **не обещает** runtime обновление при paused. Backend всё равно вернёт 403 (двойная защита).
- Результат показывается строкой `Snapshot READY · SKU: N (incomplete: M)` или `Ошибка: <code>`.

### 9. Удалено / упрощено относительно старой версии

- ❌ **`PUT /products/:id`** для редактирования `purchasePrice / commissionRate / logisticsCost / dimensions` — это был bypass §13 (manual input для marketplace-driven полей). Заменён на `PATCH /finance/products/:id/cost` со whitelist'ом 3 полей.
- ❌ **CSV export** через `Blob` — пока убран (можно вернуть как отдельную итерацию через backend endpoint, не чистый client-side).
- ❌ **Realtime calc** через `/finance/unit-economics` (legacy) — переключено на snapshot-driven `/finance/unit-economics` (новый из TASK_FINANCE_4).
- ❌ Простая колонка «ROI текстом» — теперь structured number с правильным `null` handling (`fmtPct` возвращает `—` для null).

### 10. Backward-compat

Бэкенд endpoint `/finance/unit-economics/legacy` (TASK_FINANCE_4) сохранён, но **больше нигде не используется на фронте** — можно удалить в следующей итерации, если нет внешних консьюмеров. Старый MVP-роут `/products/:id` PUT по-прежнему работает (catalog модуль), просто финансовая UX больше его не дёргает.

### 11. Проверки

- `npx tsc --noEmit` (web) → 0 ошибок.
- 0 импортов `lucide-react` / `axios` / `react` лишних — все использованы.
- Нет axios-вызовов во внешний API маркетплейсов (только domain `/finance` + `/products/:id/cost`).

### 12. DoD сверка

- ✅ **Пользователь понимает, из чего собран расчёт**: Breakdown секция в drawer'е (7 строк), Warnings секция с explain'ами, formula version + sourceFreshness в snapshot meta.
- ✅ **Incomplete и stale визуально и семантически разделены**: `FRESHNESS_BADGE` использует 4 разных цвета и текста (`FRESH_AND_COMPLETE / STALE_BUT_COMPLETE / INCOMPLETE_BUT_FRESH / STALE_AND_INCOMPLETE`); WarningType разделён на critical (rose) и non-critical (amber); STALE_FINANCIAL_SOURCE — отдельный warning тип, не смешан с MISSING_*.
- ✅ **UI не обещает runtime обновление при paused**: paused banner + disabled "Пересчитать" + disabled "Редактировать" с tooltip'ами — пользователь видит явно, что новых данных не будет до снятия паузы.
- ✅ **Дата последнего reliable refresh и formula version**: `SnapshotMetaCard` показывает оба поля как primary metadata; для каждого SKU в drawer'е виден `period` и `formulaVersion` через snapshot meta.

### 13. Что НЕ сделано (намеренно)

- **Period selector в UI** — фронт показывает текущий snapshot. Custom period rebuild доступен только программно (через кнопку — собирает за последние 30 дней). Полноценный date-range picker — TASK_FINANCE_7 (QA или отдельная UX-итерация).
- **CSV export** — убран, требует backend endpoint в следующей итерации.
- **Per-marketplace breakdown** — сейчас snapshot хранит агрегаты по всем marketplace'ам; разделение per-WB/Ozon — расширение payload'а в TASK_FINANCE_7+.
- **Tax / ads loaders** — backend ещё возвращает их `null` (TASK_FINANCE_3 loader не подгружает); UI готов и сразу подсветит, как только backend начнёт давать значения.
