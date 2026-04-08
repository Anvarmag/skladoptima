# TASK_TENANT_5 — AccessState Transitions, Warnings и Runtime Policy

> Модуль: `02-tenant`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TENANT_1`
  - `TASK_TENANT_4`
  - согласованы `13-billing`, `09-sync`, `06-inventory`
- Что нужно сделать:
  - реализовать internal transition flow для `tenant_access_state`;
  - зафиксировать allowed transitions и mapping billing/subscription -> tenant access state;
  - реализовать warnings/read model для `TRIAL_EXPIRED`, `GRACE_PERIOD`, `SUSPENDED`, `CLOSED`;
  - обеспечить, что `TRIAL_EXPIRED` сразу дает read-only режим, а не partial write access;
  - писать события переходов в audit и `tenant_access_state_events`.
- Критерий закрытия:
  - AccessState работает как единый источник истины;
  - доменные модули получают согласованную policy;
  - UI и backend одинаково понимают allowed/blocked actions.

**Что сделано**

- Не выполнено.
