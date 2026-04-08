# TASK_ORDERS_2 — Idempotent Ingestion, Duplicate/Out-of-Order Handling

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_ORDERS_1`
  - согласован `09-sync`
- Что нужно сделать:
  - реализовать ingestion заказов только через `sync`, без прямого polling из orders API;
  - проверять идемпотентность по `external_event_id` и order key;
  - логировать `duplicate_ignored` и `out_of_order_ignored` без повторного бизнес-эффекта;
  - обрабатывать устаревшие внешние статусы без отката внутреннего состояния назад;
  - блокировать новые внешние order events runtime-контуром при `TRIAL_EXPIRED / SUSPENDED / CLOSED`.
- Критерий закрытия:
  - duplicate и out-of-order события не создают повторный reserve/release/deduct;
  - orders-модуль не идет напрямую во внешний API;
  - paused integration не создает обходных side-effects.

**Что сделано**

- Не выполнено.
