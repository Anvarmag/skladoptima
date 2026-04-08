# TASK_INVENTORY_7 — QA, Regression и Observability Inventory

> Модуль: `06-inventory`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_INVENTORY_2`
  - `TASK_INVENTORY_3`
  - `TASK_INVENTORY_4`
  - `TASK_INVENTORY_5`
  - `TASK_INVENTORY_6`
- Что нужно сделать:
  - собрать regression пакет на manual adjust, reserve/release/deduct, low-stock, conflicts, idempotent replay;
  - покрыть отрицательный остаток, repeated `source_event_id`, stale external events, return logging;
  - проверить поведение inventory в `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - настроить метрики, логи и alerts по movement anomalies, negative stock blocks и idempotency collisions.
- Критерий закрытия:
  - inventory модуль подтвержден проверяемой регрессией;
  - stock correctness risks закрыты тестами;
  - observability достаточна для расследования расхождений остатков.

**Что сделано**

- Не выполнено.
