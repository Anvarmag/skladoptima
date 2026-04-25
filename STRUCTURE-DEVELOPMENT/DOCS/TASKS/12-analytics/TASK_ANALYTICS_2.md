# TASK_ANALYTICS_2 — Dashboard KPI, Revenue Dynamics и Read APIs

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_ANALYTICS_1`
- Что нужно сделать:
  - реализовать `GET /api/v1/analytics/dashboard`, `GET /api/v1/analytics/revenue-dynamics`, `GET /api/v1/analytics/products/top`, `GET /api/v1/analytics/products/:productId`;
  - ограничить первый dashboard MVP набором KPI: `revenue_net`, `orders_count`, `units_sold`, `avg_check`, `returns_count`, `top marketplace share`;
  - построить read APIs на materialized/read-model слое без тяжелых realtime joins;
  - реализовать drill-down по SKU на согласованных источниках;
  - ограничить online period range и ввести валидации по размеру окна.
- Критерий закрытия:
  - dashboard и top/drill-down APIs быстрые и детерминированные;
  - первый экран не перегружен лишними KPI;
  - backend и frontend опираются на один и тот же KPI contract.

**Что сделано**

- Не выполнено.
