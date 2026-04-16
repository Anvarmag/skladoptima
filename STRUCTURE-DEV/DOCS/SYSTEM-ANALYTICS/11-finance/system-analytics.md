# Юнит-экономика (Finance) — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль рассчитывает управленческую юнит-экономику по SKU/каналам/периодам: выручка, расходы, прибыль, маржа, ROI, предупреждения о неполных данных.

## 2. Функциональный контур и границы

### Что входит в модуль
- управленческий расчет unit economics по SKU/period;
- сбор и нормализация cost-компонентов;
- формирование snapshot/витрин для отчетов;
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

## 5. Зависимости и интеграции

- Orders (revenue/quantity)
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

## 8. Модель данных (PostgreSQL)

### `product_finance_profiles`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID`
- `base_cost NUMERIC(12,2) NULL`
- `cost_currency VARCHAR(3) DEFAULT 'RUB'`
- `is_cost_manual BOOLEAN DEFAULT true`
- `updated_by UUID`, `updated_at`
- `UNIQUE(tenant_id, product_id)`

### `finance_snapshots`
- `id UUID PK`, `tenant_id UUID`
- `period_from DATE`, `period_to DATE`, `period_type ENUM(week, month, custom)`
- `payload JSONB` (агрегаты + per SKU)
- `generated_at`, `generated_by UUID NULL`

### `finance_data_warnings`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID`
- `warning_type ENUM(missing_cost, missing_fees, missing_logistics, missing_tax)`
- `is_active BOOLEAN`, `created_at`, `resolved_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Собрать входные данные: orders + reports + cost profile + tax settings.
2. Рассчитать `revenue`, затем все расходы по источникам.
3. `profit = revenue - all_costs`; `margin = profit/revenue`; `roi = profit/base_cost`.
4. Если критичный вход отсутствует — выставить warning и `isIncomplete=true`.
5. По запросу сформировать snapshot периода для стабильного отображения истории.

## 10. Валидации и ошибки

- `base_cost >= 0`.
- Период `from <= to`, длина `custom` <= 366 дней.
- Ошибки:
  - `VALIDATION_ERROR: INVALID_PERIOD`
  - `NOT_FOUND: PRODUCT_NOT_FOUND`
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

## 13. Источники данных для расчета

- `orders` — выручка и количество продаж
- `marketplace financial reports` — комиссии, удержания, логистика, возвраты
- `product_finance_profiles` — себестоимость
- `tenant_settings` — налоговая система
- optional manual charges future-ready

## 14. Формулы MVP

- `Revenue = sum(order_amount)`
- `COGS = sold_qty * base_cost`
- `Profit = Revenue - COGS - MarketplaceFees - Logistics - ReturnsImpact - TaxImpact - Advertising - AdditionalCharges`
- `MarginPct = Profit / Revenue * 100`
- `ROIPct = Profit / COGS * 100`

### Правило неполного расчета
- если отсутствует хотя бы один критичный компонент, показатель можно посчитать, но строка обязана иметь `isIncomplete=true`

## 15. Async и snapshot strategy

- nightly job на rebuild daily/period snapshots
- on-demand rebuild по manual trigger owner/admin
- warning resolution job, который закрывает warning после появления недостающих данных

## 16. Тестовая матрица

- Полный расчет при наличии всех данных.
- Расчет без себестоимости.
- Расчет без marketplace fees.
- Смена cost profile и пересчет периода.
- Разные tax systems на tenant.

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

## 19. Observability, логи и алерты

- Метрики: `finance_snapshots_generated`, `snapshot_generation_failures`, `warning_incomplete_count`, `negative_margin_sku_count`, `cost_profile_updates`.
- Логи: snapshot job summary, missing-input reasons, formula version applied, recalculation triggers.
- Алерты: массовые incomplete warnings, длительная генерация snapshot, резкие расхождения между периодами без входных изменений.
- Dashboards: finance snapshot health, completeness board, negative margin monitor.

## 20. Риски реализации и архитектурные замечания

- Самый частый провал в таких модулях: смешение управленческих и бухгалтерских правил без явного разграничения.
- Формулы должны быть versioned, иначе исторические цифры станут неповторимыми.
- Missing data нужно трактовать как отдельное состояние расчета, а не silently default-to-zero.
- Finance модуль должен потреблять нормализованные источники, а не напрямую зависеть от сырого API маркетплейсов.
