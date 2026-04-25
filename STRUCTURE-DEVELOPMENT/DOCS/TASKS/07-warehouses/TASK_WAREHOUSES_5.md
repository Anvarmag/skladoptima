# TASK_WAREHOUSES_5 — Tenant-State Guards, Refresh Policy и External Truth Rules

> Модуль: `07-warehouses`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_WAREHOUSES_2`
  - `TASK_WAREHOUSES_3`
  - `TASK_WAREHOUSES_4`
  - согласованы `02-tenant`, `08-marketplace-accounts`
- Что нужно сделать:
  - запретить ручной refresh через UI при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - оставить справочник read-only доступным в `TRIAL_EXPIRED`;
  - при `SUSPENDED/CLOSED` показывать только read-only state без внешних API действий;
  - закрепить правило, что warehouses остаются reference-only модулем, а не вторым inventory;
  - не допускать ручного обхода sync source-of-truth.
- Критерий закрытия:
  - warehouse модуль согласован с tenant commercial policy;
  - manual refresh не обходит pause/block rules;
  - external truth rules одинаково соблюдаются в backend и UI.

**Что сделано**

- Не выполнено.
