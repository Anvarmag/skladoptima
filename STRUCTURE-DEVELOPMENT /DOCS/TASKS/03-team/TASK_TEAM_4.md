# TASK_TEAM_4 — Team RBAC, Role Matrix и Last-Owner Guard

> Модуль: `03-team`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TEAM_1`
  - `TASK_TEAM_3`
- Что нужно сделать:
  - реализовать role matrix `OWNER / ADMIN / MANAGER / STAFF`;
  - разрешить `ADMIN` отправлять invite, делать resend/cancel и удалять `MANAGER/STAFF`;
  - запретить `ADMIN` менять/удалять `OWNER` и эскалировать себя в `OWNER`;
  - реализовать `PATCH role`, `DELETE member`, `POST leave`;
  - внедрить last-owner guard: последнего owner нельзя удалить, понизить или позволить ему выйти.
- Критерий закрытия:
  - team actions соответствуют утвержденной role policy;
  - last-owner guard работает во всех mutating сценариях;
  - `MANAGER` и `STAFF` не получают скрытых team-management прав.

**Что сделано**

- Не выполнено.
