# TASK_TENANT_3 — Tenant Switch, Bootstrap и Trusted Tenant Context

> Модуль: `02-tenant`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_TENANT_2`
- Что нужно сделать:
  - реализовать `GET /tenants`, `GET /tenants/current`, `POST /tenants/:tenantId/switch`;
  - гарантировать, что downstream tenant context берется только из trusted session/bootstrap;
  - поддержать last used tenant, tenant picker и fallback сценарии;
  - запретить вход в `CLOSED` tenant через switch flow.
- Критерий закрытия:
  - multi-tenant пользователь безопасно переключает рабочую компанию;
  - нет возможности подменить tenant через body/query/local storage;
  - bootstrap payload согласован с `auth` и `team`.

**Что сделано**

- Не выполнено.
