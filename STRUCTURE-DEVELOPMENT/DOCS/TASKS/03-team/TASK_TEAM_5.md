# TASK_TEAM_5 — Tenant State Guards, Async и Audit для Team

> Модуль: `03-team`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_TEAM_2`
  - `TASK_TEAM_4`
  - согласованы `02-tenant`, `15-notifications`, `16-audit`
- Что нужно сделать:
  - заблокировать team write-actions при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` по tenant policy;
  - оставить read-only список команды там, где это разрешено политикой;
  - публиковать async события `team_invitation_created/resent/accepted/cancelled`, `membership_role_changed`, `membership_removed`, `membership_left`;
  - писать audit trail для invite/member/role операций;
  - реализовать nightly job для перевода просроченных invite в `EXPIRED`.
- Критерий закрытия:
  - team модуль уважает tenant access-state;
  - async flow и audit покрывают все критичные операции;
  - просроченные invite корректно уходят в `EXPIRED`.

**Что сделано**

- Не выполнено.
