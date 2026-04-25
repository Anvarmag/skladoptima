# TASK_ORDERS_5 — API List/Details/Timeline и Safe Reprocess

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_ORDERS_1`
  - `TASK_ORDERS_2`
  - `TASK_ORDERS_3`
  - `TASK_ORDERS_4`
- Что нужно сделать:
  - реализовать `GET /api/v1/orders`, `GET /api/v1/orders/:orderId`, `GET /api/v1/orders/:orderId/timeline`;
  - реализовать `POST /api/v1/orders/:orderId/reprocess`;
  - в `reprocess` повторно прогонять только внутреннюю обработку уже сохраненного события;
  - не допускать обращение `reprocess` во внешний API;
  - отдать filters по marketplace, fulfillment mode, internal status, stock effect status.
- Критерий закрытия:
  - orders API покрывает operational read scenarios и timeline;
  - safe reprocess не ломает idempotency и не ходит наружу;
  - owner/admin/manager получают только допустимые действия по роли.

**Что сделано**

- Не выполнено.
