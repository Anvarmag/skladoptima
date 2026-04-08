# TASK_TEAM_1 — Data Model, Invitations и Membership Lifecycle

> Модуль: `03-team`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `03-team`
  - согласованы `01-auth` и `02-tenant`
- Что нужно сделать:
  - завести/уточнить модель `invitations`, `memberships`, `team_events`;
  - зафиксировать lifecycle `PENDING/ACCEPTED/EXPIRED/CANCELLED` для invite и `PENDING/ACTIVE/REVOKED/LEFT` для membership;
  - обеспечить `UNIQUE(tenant_id, user_id)` и ограничения по одному `pending` invite на `tenant + normalized_email`;
  - запретить invite на роль `OWNER` в MVP и повторную активацию `LEFT/REVOKED` участника.
- Критерий закрытия:
  - модель данных соответствует `03-team`;
  - invitation и membership lifecycle реализуемы без серых зон;
  - инварианты last-owner и uniqueness зафиксированы на DB и domain уровне.

**Что сделано**

- Не выполнено.
