# TASK_AUDIT_4 — Read API, RBAC Filters и Tenant/Internal Visibility Scopes

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_AUDIT_1`
  - `TASK_AUDIT_2`
  - `TASK_AUDIT_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/audit/logs`, `GET /api/v1/audit/logs/:id`, `GET /api/v1/audit/security-events`, `GET /api/v1/audit/coverage-status`;
  - применить RBAC filters: в MVP tenant-facing audit доступен только `OWNER` и `ADMIN`;
  - не отдавать `internal_only` записи в tenant-facing API;
  - обеспечить фильтрацию по tenant/entity/actor/time/request/correlation;
  - поддержать history read-only доступ в `TRIAL_EXPIRED / SUSPENDED / CLOSED`.
- Критерий закрытия:
  - audit read API пригоден для расследований и drill-down;
  - RBAC и visibility scope соблюдаются последовательно;
  - paused tenant не теряет историческое чтение при валидной сессии и допущенной роли.

**Что сделано**

- Не выполнено.
