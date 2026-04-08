# TASK_BILLING_5 — Reminder Jobs, Reconciliation и Support/Admin Boundaries

> Модуль: `13-billing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_BILLING_2`
  - `TASK_BILLING_3`
  - `TASK_BILLING_4`
  - согласованы `15-notifications`, `19-admin`
- Что нужно сделать:
  - реализовать reminder jobs `7/5/3/1` дней до критичных billing событий;
  - реализовать grace-to-suspended scheduler и reconciliation по зависшим платежам;
  - описать support/admin действия только в рамках утвержденных contracts: диагностика, но без hidden billing overrides;
  - исключить `special access / support override` из MVP runtime surface;
  - журналировать scheduler/reconciliation решения в subscription events и audit.
- Критерий закрытия:
  - фоновые billing jobs покрывают reminders, grace expiry и reconciliation;
  - support/admin контур не размывает коммерческую policy;
  - runtime MVP не содержит обходных override-функций.

**Что сделано**

- Не выполнено.
