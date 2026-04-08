# TASK_ANALYTICS_1 — Materialized Daily Layer и Analytics Data Model

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - утверждена системная аналитика `12-analytics`
  - согласованы `10-orders`, `11-finance`
- Что нужно сделать:
  - завести `analytics_materialized_daily`, `analytics_abc_snapshots`, `analytics_recommendations`;
  - закрепить KPI поля daily layer: `revenue_net`, `orders_count`, `units_sold`, `returns_count`, `avg_check`, `by_marketplace`;
  - предусмотреть `formula_version`, `snapshot_status`, `source_freshness`;
  - подготовить хранение explainable recommendation payload с `rule_key`, `reason_code`, `priority`;
  - согласовать модель с orders, catalog, finance и inventory read sources.
- Критерий закрытия:
  - data model покрывает dashboard, ABC и recommendation layer;
  - read-model слой отделен от OLTP и пригоден для быстрых API;
  - freshness/completeness markers выражены явно.

**Что сделано**

- Не выполнено.
