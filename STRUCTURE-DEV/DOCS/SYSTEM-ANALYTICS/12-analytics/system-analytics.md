# Аналитика продаж (ABC) — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль предоставляет dashboard продаж и ассортимента: выручка, заказы, средний чек, динамика по времени, ABC-группы, top SKU, рекомендационный слой.

## 2. Функциональный контур и границы

### Что входит в модуль
- продуктовые read-model для sales overview и ABC;
- агрегации по периодам, каналам, SKU и категориям;
- recommendation layer на rule-based правилах;
- drill-down из агрегатов в сущности;
- export/report endpoints для управленческого потребления.

### Что не входит в модуль
- raw event collection как отдельная data platform;
- финансовые формулы beyond подключенных snapshot;
- ML/forecasting platform;
- ad-hoc BI конструктор уровня enterprise.

### Главный результат работы модуля
- пользователь получает быстрый слой управленческой аналитики, построенный на согласованных read-model, а не на тяжелых запросах к transactional данным.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin/Manager | Читает dashboard и drill-down | Основные потребители |
| Analytics service | Строит snapshots и рекомендации | Не является источником raw truth |
| Orders/Finance/Catalog | Поставляют нормализованные данные | Внешние доменные источники |
| Product/Data | Управляют KPI definition и rule-set | Не должны менять historical snapshots бесследно |

## 4. Базовые сценарии использования

### Сценарий 1. Открытие dashboard
1. Пользователь выбирает период.
2. Backend читает готовые aggregates/read-model.
3. Возвращает KPI cards, trend series и ABC groups.
4. UI строит быструю витрину без тяжелых realtime joins.

### Сценарий 2. Drill-down по SKU
1. Пользователь кликает по KPI/ABC элементу.
2. Backend извлекает детальные данные по выбранной сущности и периоду.
3. UI показывает вклад SKU, группу ABC, динамику и рекомендации.

### Сценарий 3. Recommendation engine
1. Snapshot job применяет набор правил к агрегированным данным.
2. Создаются explainable recommendations с reason-code.
3. UI показывает рекомендации и может записывать факт пользовательского действия.

## 5. Зависимости и интеграции

- Orders (primary source)
- Catalog (атрибуты SKU)
- Finance (опционально для enriched-view)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/analytics/dashboard` | Owner/Admin/Manager | Главный dashboard |
| `GET` | `/api/v1/analytics/revenue-dynamics` | Owner/Admin/Manager | График выручки |
| `GET` | `/api/v1/analytics/abc` | Owner/Admin/Manager | ABC-классификация |
| `GET` | `/api/v1/analytics/products/top` | Owner/Admin/Manager | Топ товаров |
| `GET` | `/api/v1/analytics/products/:productId` | Owner/Admin/Manager | Drill-down SKU |
| `GET` | `/api/v1/analytics/recommendations` | Owner/Admin/Manager | Rule-based рекомендации |
| `GET` | `/api/v1/analytics/export` | Owner/Admin | Экспорт отчета |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/analytics/abc?from=2026-03-01&to=2026-03-31&groupBy=revenue' \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "groups": {
    "A": [{ "productId": "prd_1", "sharePct": 22.3 }],
    "B": [{ "productId": "prd_7", "sharePct": 8.1 }],
    "C": [{ "productId": "prd_12", "sharePct": 1.2 }]
  },
  "meta": { "periodFrom": "2026-03-01", "periodTo": "2026-03-31" }
}
```

## 8. Модель данных (PostgreSQL)

### `analytics_materialized_daily`
- `id UUID PK`, `tenant_id UUID`, `date DATE`
- `revenue_gross NUMERIC(14,2)`
- `revenue_net NUMERIC(14,2)`
- `orders_count INT`, `units_sold INT`, `returns_count INT`
- `avg_check NUMERIC(12,2)`
- `by_marketplace JSONB`
- `UNIQUE(tenant_id, date)`

### `analytics_abc_snapshots`
- `id UUID PK`, `tenant_id UUID`
- `period_from DATE`, `period_to DATE`
- `metric ENUM(revenue, units)`
- `payload JSONB`
- `created_at`

### `analytics_recommendations`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID NULL`
- `rule_key VARCHAR(64)`, `priority ENUM(low, medium, high)`
- `message TEXT`, `status ENUM(active, dismissed, applied)`
- `created_at`, `updated_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Daily job агрегирует orders в `analytics_materialized_daily`.
2. Dashboard читает агрегаты без тяжелых on-the-fly расчетов.
3. ABC строится по выбранному периоду и сохраняется snapshot.
4. Rule engine создает рекомендации (например, low stock + high demand).
5. Drill-down SKU строится из orders + materialized daily срезов.

## 10. Валидации и ошибки

- Ограничить максимальный диапазон `to-from` для online запроса.
- Ошибки:
  - `VALIDATION_ERROR: PERIOD_TOO_LARGE`
  - `NOT_FOUND: PRODUCT_ANALYTICS_NOT_FOUND`

## 11. Чеклист реализации

- [ ] Daily aggregation pipeline.
- [ ] API dashboard/abc/top/drill-down/export.
- [ ] Rule-based recommendation engine.
- [ ] Тесты консистентности агрегатов.

## 12. Критерии готовности (DoD)

- Dashboard грузится быстро на production-объеме.
- ABC отчеты повторяемы и объяснимы.
- Drill-down корректно связан с исходными order данными.

## 13. Витрины и read models

### Что лучше не считать on-the-fly
- revenue dynamics по дням
- ABC-группы на больших периодах
- top SKU по tenant

### Что допустимо считать онлайн
- небольшие drill-down по одному SKU
- пересчет recommendations по простым rule-based условиям

## 14. Правила ABC-классификации

- сортировка SKU по убыванию выручки
- накопительная доля:
- `A` — первые 80%
- `B` — следующие 15%
- `C` — оставшиеся 5%

### Важно
- алгоритм должен быть детерминированным
- тай-брейк при равной выручке: `sku asc` или `product_id asc`

## 15. Async и события

- daily aggregation jobs
- ABC snapshot rebuild jobs
- recommendation refresh jobs

### События
- `analytics_snapshot_built`
- `analytics_recommendation_created`
- `analytics_recommendation_dismissed`

## 16. Тестовая матрица

- Dashboard на пустом tenant.
- Dashboard на периоде с продажами.
- ABC при одинаковой выручке у нескольких SKU.
- Top products с фильтром marketplace.
- Drill-down по SKU без продаж.

## 17. Фазы внедрения

1. Daily materialized layer.
2. Dashboard + revenue dynamics.
3. ABC snapshot engine.
4. Top SKU + drill-down.
5. Recommendation engine и export.

## 18. Нефункциональные требования и SLA

- Dashboard и ABC отчеты должны читать готовые aggregates/read-model; прямой access к OLTP под тяжелую аналитику недопустим.
- Типовой отчет должен открываться быстро: `p95 < 700 мс`.
- Read-model rebuild должен быть воспроизводимым и version-aware.
- Export и drill-down не должны нарушать tenant isolation и RBAC.

## 19. Observability, логи и алерты

- Метрики: `dashboard_opens`, `snapshot_build_duration`, `abc_recompute_count`, `recommendations_generated`, `export_failures`.
- Логи: snapshot build runs, recommendation rule evaluation, drill-down query context.
- Алерты: stale read-model, рост failed exports, аномально долгий rebuild, empty dashboards for active tenants.
- Dashboards: analytics freshness board, export reliability, recommendation coverage board.

## 20. Риски реализации и архитектурные замечания

- Нельзя строить пользовательский analytics UX на “живых” транзакционных данных без snapshot strategy.
- ABC и recommendation logic должны быть explainable и versioned; иначе продукт потеряет доверие.
- Следует жестко отделить KPI definition от способа их визуализации, чтобы backend и frontend не расходились.
- Если в read-model смешать gross/net revenue без стандарта, последующая аналитика станет непригодной.
