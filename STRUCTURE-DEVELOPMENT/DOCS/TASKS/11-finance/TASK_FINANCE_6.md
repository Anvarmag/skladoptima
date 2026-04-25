# TASK_FINANCE_6 — Frontend Unit Economics UX и Diagnostics

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_FINANCE_3`
  - `TASK_FINANCE_4`
  - `TASK_FINANCE_5`
- Что нужно сделать:
  - собрать profitability table, dashboard и SKU detail с breakdown по компонентам;
  - явно показывать `isIncomplete`, active warnings и `stale snapshot`;
  - реализовать UX для редактирования `base_cost / packaging_cost / additional_cost`;
  - блокировать rebuild actions при `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - показывать дату последнего reliable refresh и formula version там, где это критично для доверия к цифрам.
- Критерий закрытия:
  - пользователь понимает, из чего собран расчет и чего ему не хватает;
  - incomplete и stale визуально и семантически разделены;
  - UI не обещает runtime обновление там, где tenant policy его блокирует.

**Что сделано**

- Не выполнено.
