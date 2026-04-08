# TASK_INVENTORY_4 — Idempotency Locks, Reconciliation и Conflict Handling

> Модуль: `06-inventory`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_INVENTORY_1`
  - `TASK_INVENTORY_3`
  - согласованы `09-sync` и `18-worker`
- Что нужно сделать:
  - внедрить `inventory_effect_locks` для order/sync side-effects;
  - игнорировать повторное применение одного и того же business event;
  - реализовать конфликт-детектор устаревших внешних событий и reconciliation path;
  - зафиксировать политику optimistic/pessimistic locking для reserve path;
  - обеспечить наблюдаемость idempotency collisions и reserve/release mismatch.
- Критерий закрытия:
  - повторные события не меняют остаток повторно;
  - conflicts и stale external events диагностируются явно;
  - inventory выдерживает retry/replay без потери корректности.

**Что сделано**

- Не выполнено.
