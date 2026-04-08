# TASK_SYNC_4 — Item-Level Diagnostics, Conflicts и Idempotency

> Модуль: `09-sync`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_SYNC_1`
  - согласованы `05-catalog`, `06-inventory`, `10-orders`
- Что нужно сделать:
  - хранить item-level записи только для `failed / conflict / blocked` кейсов;
  - реализовать `sync_conflicts` и диагностическую выдачу по ним;
  - передавать вниз стабильный `external_event_id` или `source_event_id` для дедупликации;
  - ввести run-level idempotency через `Idempotency-Key` или `job_key`;
  - не допускать повторного бизнес-эффекта от одного и того же внешнего события.
- Критерий закрытия:
  - конфликтные и проблемные элементы не теряются;
  - success path не раздувает storage и шум в diagnostics;
  - downstream модули получают стабильные idempotency identifiers.

**Что сделано**

- Не выполнено.
