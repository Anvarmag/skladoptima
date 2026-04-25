# TASK_ANALYTICS_3 — ABC Snapshot Engine, Formula Versioning и Deterministic Ranking

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_ANALYTICS_1`
  - `TASK_ANALYTICS_2`
- Что нужно сделать:
  - реализовать `GET /api/v1/analytics/abc`;
  - строить ABC snapshot по `revenue_net`, а не по gross revenue;
  - закрепить rule `A=80%`, `B=15%`, `C=5%`;
  - добавить deterministic tie-breaker при равной выручке: `sku asc` или `product_id asc`;
  - version-ировать ABC формулу и rebuild policy.
- Критерий закрытия:
  - ABC отчет повторяем, объясним и не зависит от нестабильного порядка данных;
  - net revenue policy соблюдается во всех срезах;
  - snapshot layer пригоден для rebuild и auditability.

**Что сделано**

- Не выполнено.
