# Юнит-экономика (Finance) — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `11-finance`

## 1. Назначение модуля

Модуль рассчитывает управленческую юнит-экономику по SKU/каналам/периодам: выручка, расходы, прибыль, маржа, ROI, предупреждения о неполных данных.

### Текущее состояние (as-is)

- в backend уже существует модуль `finance` с endpoint `unit-economics`, а во frontend есть страница `UnitEconomics`;
- текущий контур закрывает базовую выдачу unit economics, но cost profiles, warnings и snapshot strategy еще не разведены полностью как самостоятельные слои;
- финансовая модель уже присутствует в продукте, но документированная целевая архитектура шире текущего набора endpoint и UI.

### Целевое состояние (to-be)

- finance должен рассчитывать воспроизводимую управленческую юнит-экономику по SKU, каналу и периоду;
- любая неполнота входных данных должна приводить к явному warning, а не к молчаливым нулям;
- finance должен опираться только на нормализованные внутренние источники (`orders`, cost profiles, marketplace reports/snapshots), а не на прямые внешние API вызовы из UI;
- rebuild и snapshot policy должны уважать `tenant AccessState`: при `TRIAL_EXPIRED / SUSPENDED / CLOSED` чтение доступно, но внешние источники не подтягиваются runtime-обходом;
- финансовые отчеты должны строиться на snapshot/read-model слое с формульным versioning.


## 2. Функциональный контур и границы

### Что входит в модуль
- управленческий расчет unit economics по SKU/period;
- сбор и нормализация cost-компонентов;
- формирование snapshot/витрин для отчетов;
- versioned formulas и reproducibility контур;
- предупреждения о неполных данных;
- отдача finance read-model в UI и аналитику.

### Что не входит в модуль
- бухгалтерский и налоговый учет в юридическом смысле;
- фактический payment ledger провайдера;
- ad-tech ETL beyond согласованных cost feeds;
- ручное редактирование заказов/остатков как источников.

### Главный результат работы модуля
- пользователь видит воспроизводимую управленческую прибыльность по товарам и понимает, каких входных данных не хватает для полного расчета.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin | Анализирует прибыльность и задает cost profile | Основные операторы модуля |
| Manager | Просматривает прибыльность и warnings | Без редактирования cost inputs и rebuild |
| Finance/Product analyst | Определяет правила формул | Источник бизнес-логики расчета |
| Orders/Ads/Marketplace reports | Поставляют финансовые входы | Не должны напрямую формировать final KPI |
| Analytics module | Потребляет finance snapshots | Работает на готовой read-model |

## 4. Базовые сценарии использования

### Сценарий 1. Настройка cost profile товара
1. Пользователь открывает SKU.
2. Вводит себестоимость и обязательные cost-компоненты.
3. Backend валидирует диапазоны и сохраняет профиль.
4. Следующие snapshots используют обновленные правила.

### Сценарий 2. Построение snapshot за период
1. Финансовый job собирает orders, returns, fees, ads, taxes и product costs.
2. Для каждой SKU/period комбинации рассчитываются показатели.
3. Если данных не хватает, создается warning с перечислением missing components.
4. Snapshot сохраняется как read-model для UI.

### Сценарий 3. Просмотр прибыльности товара
1. Пользователь запрашивает отчет.
2. Backend возвращает snapshot values и warning state.
3. UI может показать детализацию по расходным компонентам и причину неполного расчета.

### Сценарий 4. Tenant уходит в `TRIAL_EXPIRED`
1. Tenant переводится в `TRIAL_EXPIRED`.
2. Уже построенные finance snapshots остаются доступны для чтения.
3. Manual rebuild snapshots и любые flow, требующие новых внешних financial inputs, блокируются.
4. Пользователь продолжает видеть последние доступные данные с указанием даты актуальности.

## 5. Зависимости и интеграции

- Orders (revenue/quantity)
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)
- Marketplace Accounts / Sync (freshness и paused integration state)
- Marketplace reports (fees/logistics/charges)
- Catalog (cost profile)
- Tenant settings (tax system)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/finance/unit-economics` | Owner/Admin/Manager | Таблица юнит-экономики |
| `GET` | `/api/v1/finance/unit-economics/:productId` | Owner/Admin/Manager | Деталь по SKU |
| `PATCH` | `/api/v1/finance/products/:productId/cost` | Owner/Admin | Обновить себестоимость |
| `GET` | `/api/v1/finance/dashboard` | Owner/Admin/Manager | Агрегированные KPI |
| `POST` | `/api/v1/finance/snapshots/rebuild` | Owner/Admin | Пересчет snapshot периода |
| `GET` | `/api/v1/finance/snapshots/status` | Owner/Admin/Manager | Freshness и статус последнего расчета |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/finance/unit-economics?periodType=month&from=2026-03-01&to=2026-03-31&marketplace=OZON' \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "items": [
    {
      "productId": "prd_...",
      "sku": "SKU-1001",
      "revenue": 120000,
      "cost": 65000,
      "marketplaceFees": 14000,
      "logistics": 6000,
      "returnsImpact": 2500,
      "taxImpact": 3000,
      "profit": 29500,
      "marginPct": 24.58,
      "roiPct": 45.38,
      "isIncomplete": false
    }
  ]
}
```

### Frontend поведение

- Текущее состояние: маршрут `/app/finance` и страница `UnitEconomics` уже существуют.
- Целевое состояние: интерфейс должен показать profitability table, dashboard, breakdown расходов, warnings и rebuild состояния.
- UX-правило: пользователь обязан понимать из каких компонентов собран расчет и почему строка отмечена как incomplete.
- UI должен различать `incomplete data` и `stale snapshot`: это разные причины недоверия к цифре.
- В MVP обязательное ядро расчета строится на `base_cost + marketplace fees + logistics`; отсутствие `ads / tax / returns` не блокирует расчет, но должно быть явно подсвечено warning-ами.
- При `TRIAL_EXPIRED` finance остается доступным для чтения, но rebuild и обновление данных через интеграции не запускаются.
- При `SUSPENDED/CLOSED` доступ только read-only к последним сохраненным snapshot.

## 8. Модель данных (PostgreSQL)

### `product_finance_profiles`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID`
- `base_cost NUMERIC(12,2) NULL`
- `packaging_cost NUMERIC(12,2) NULL`
- `additional_cost NUMERIC(12,2) NULL`
- `cost_currency VARCHAR(3) DEFAULT 'RUB'`
- `is_cost_manual BOOLEAN DEFAULT true`
- `updated_by UUID`, `updated_at`
- `UNIQUE(tenant_id, product_id)`

### `finance_snapshots`
- `id UUID PK`, `tenant_id UUID`
- `period_from DATE`, `period_to DATE`, `period_type ENUM(week, month, custom)`
- `formula_version VARCHAR(32) NOT NULL`
- `snapshot_status ENUM(ready, incomplete, failed) NOT NULL DEFAULT 'ready'`
- `payload JSONB` (агрегаты + per SKU)
- `source_freshness JSONB NULL`
- `generated_at`, `generated_by UUID NULL`

### `finance_data_warnings`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID`
- `snapshot_id UUID NULL`
- `warning_type ENUM(missing_cost, missing_fees, missing_logistics, missing_tax, stale_financial_source, missing_ads_cost, missing_returns_data)`
- `is_active BOOLEAN`, `created_at`, `resolved_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Собрать входные данные: normalized orders + marketplace financial reports + cost profile + tax settings.
2. Проверить completeness/freshness каждого источника и записать source diagnostics.
3. Рассчитать `revenue`, затем все расходы по источникам.
4. `profit = revenue - all_costs`; `margin = profit/revenue`; `roi = profit/cogs`.
5. Если критичный вход отсутствует — выставить warning и `isIncomplete=true`, но не подменять пропуск нулем молча.
6. По запросу или по job сформировать snapshot периода с `formula_version` для стабильного отображения истории.

## 10. Валидации и ошибки

- `base_cost >= 0`.
- `packaging_cost >= 0`, `additional_cost >= 0`.
- Период `from <= to`, длина `custom` <= 366 дней.
- rebuild запрещен при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
- manual input в MVP разрешен только для `base_cost`, `packaging_cost`, `additional_cost`.
- Ошибки:
  - `VALIDATION_ERROR: INVALID_PERIOD`
  - `NOT_FOUND: PRODUCT_NOT_FOUND`
  - `FORBIDDEN: FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE`
  - `CONFLICT: SNAPSHOT_REBUILD_IN_PROGRESS`

## 11. Чеклист реализации

- [ ] Миграции `product_finance_profiles`, `finance_snapshots`, warnings.
- [ ] Расчетный сервис с прозрачными формулами.
- [ ] API таблицы, детали и dashboard.
- [ ] Warnings по неполным данным.
- [ ] Тесты на корректность формул.

## 12. Критерии готовности (DoD)

- Финрасчет воспроизводим и детерминирован.
- Причина каждого warning видна пользователю.
- Owner/Admin могут управлять cost-profile.
- Для каждой цифры можно восстановить `formula_version` и freshness исходных данных.
- MVP-расчет остается доступным даже без `ads / tax / returns`, но такие строки маркируются как incomplete.

## 13. Источники данных для расчета

- `orders` — выручка и количество продаж
- `marketplace financial reports` — комиссии, удержания, логистика, возвраты
- `product_finance_profiles` — себестоимость
- `tenant_settings` — налоговая система
- optional manual charges future-ready

### Правило источников истины
- revenue и sold_qty берутся только из нормализованных `orders`;
- комиссии/логистика/удержания берутся только из finance/report feeds;
- manual input в MVP допускается только для product-level cost profile, а не для подмены marketplace revenue/fees.
- ручной ввод периодных расходов в MVP не поддерживается.

## 14. Формулы MVP

- `Revenue = sum(order_amount)`
- `COGS = sold_qty * (base_cost + packaging_cost)`
- `Profit = Revenue - COGS - MarketplaceFees - Logistics - ReturnsImpact - TaxImpact - Advertising - AdditionalCharges`
- `MarginPct = Profit / Revenue * 100`
- `ROIPct = Profit / COGS * 100`

### Правило неполного расчета
- если отсутствует хотя бы один критичный компонент, показатель можно посчитать, но строка обязана иметь `isIncomplete=true`

### MVP правило обязательных cost components
- обязательные компоненты для базового profit-расчета: `base_cost`, `marketplace fees`, `logistics`;
- `ads`, `tax`, `returns` в MVP считаются optional/improving inputs: при отсутствии не блокируют строку, но создают warning и `isIncomplete=true`.

### Правило stale snapshot
- если источники не обновлялись дольше допустимого окна, snapshot может быть `ready`, но UI обязан показать stale warning и дату последнего reliable refresh

## 15. Async и snapshot strategy

- nightly job на rebuild daily/period snapshots
- on-demand rebuild по manual trigger owner/admin
- warning resolution job, который закрывает warning после появления недостающих данных
- rebuild не должен сам инициировать внешние sync-вызовы; он работает только по уже нормализованным внутренним источникам

## 16. Тестовая матрица

- Полный расчет при наличии всех данных.
- Расчет без себестоимости.
- Расчет без marketplace fees.
- Stale marketplace reports при наличии orders.
- Расчет без `ads/tax/returns` помечается incomplete, но не исчезает.
- Смена cost profile и пересчет периода.
- Разные tax systems на tenant.
- Блокировка rebuild в `TRIAL_EXPIRED`.
- Попытка ручного ввода периодных расходов отклоняется в MVP.

## 17. Фазы внедрения

1. Cost profile и warnings.
2. Runtime calculator service.
3. Dashboard/table/detail endpoints.
4. Snapshots и rebuild jobs.
5. Тесты формул и consistency checks.

## 18. Нефункциональные требования и SLA

- Финансовые отчеты строятся на snapshot/read-model, а не на тяжелом realtime join большого количества таблиц.
- Повторный расчет одного и того же периода при одинаковых входах должен быть детерминированным.
- Finance read API должен отдавать агрегаты быстро: `p95 < 700 мс` для стандартных фильтров.
- Все денежные поля должны иметь согласованную точность/округление и валютную политику.
- Snapshot rebuild должен быть идемпотентным по `(tenant, period_from, period_to, formula_version)` или явному rebuild job key.

## 19. Observability, логи и алерты

- Метрики: `finance_snapshots_generated`, `snapshot_generation_failures`, `warning_incomplete_count`, `negative_margin_sku_count`, `cost_profile_updates`.
- Логи: snapshot job summary, missing-input reasons, formula version applied, recalculation triggers, source freshness decisions.
- Алерты: массовые incomplete warnings, длительная генерация snapshot, резкие расхождения между периодами без входных изменений, массовый stale state по финансовым источникам.
- Dashboards: finance snapshot health, completeness board, stale-source board, negative margin monitor.

## 20. Риски реализации и архитектурные замечания

- Самый частый провал в таких модулях: смешение управленческих и бухгалтерских правил без явного разграничения.
- Формулы должны быть versioned, иначе исторические цифры станут неповторимыми.
- Missing data нужно трактовать как отдельное состояние расчета, а не silently default-to-zero.
- Finance модуль должен потреблять нормализованные источники, а не напрямую зависеть от сырого API маркетплейсов.
- Если разрешить finance rebuild напрямую дергать внешние интеграции, модуль начнет нарушать уже согласованные tenant/account runtime guards.
- Если рано открыть ручной ввод периодных расходов, finance быстро потеряет воспроизводимость и превратится в смесь факта и ручных допущений.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю finance больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены tenant-state guards, formula/source versioning и открытые решения по обязательным cost components и manual inputs | Codex |
| 2026-04-18 | Подтверждены обязательные MVP cost components и ограничение manual input только product cost profile | Codex |
