# TASK_ANALYTICS_4 — Recommendations, Status API и Export

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_ANALYTICS_1`
  - `TASK_ANALYTICS_2`
  - `TASK_ANALYTICS_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/analytics/recommendations`, `GET /api/v1/analytics/status`, `GET /api/v1/analytics/export`;
  - оставить recommendations в MVP только `rule-based read-only`;
  - не внедрять пользовательский workflow `dismiss/applied`;
  - формировать explainable recommendations с `rule_key`, `reason_code`, `priority`;
  - подготовить export без нарушения tenant isolation и RBAC.
- Критерий закрытия:
  - recommendations остаются аналитическим, а не task-management слоем;
  - status API объясняет freshness/completeness/rebuild state;
  - export работает на готовых витринах, а не на тяжелых live queries.

**Что сделано**

- Не выполнено.
