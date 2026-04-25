# TASK_INVENTORY_3 — Reserve, Release, Deduct Contracts с Orders

> Модуль: `06-inventory`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_INVENTORY_1`
  - `TASK_INVENTORY_2`
  - согласован `10-orders`
- Что нужно сделать:
  - реализовать сервисные контракты `reserve`, `release`, `deduct` от orders;
  - требовать стабильный `source_event_id` и scope `tenant/product/warehouse`;
  - обеспечить транзакционное изменение `on_hand/reserved/available`;
  - логировать reserve/cancel/fulfill через movements;
  - не делать auto-restock на return, только `return_logged`.
- Критерий закрытия:
  - order side-effects предсказуемо меняют inventory;
  - reserve/release/deduct не создают повторных side-effects;
  - return flow соответствует утвержденной MVP policy.

**Что сделано**

- Не выполнено.
