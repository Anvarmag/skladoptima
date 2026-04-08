# TASK_TENANT_1 — Tenant Data Model, AccessState и миграции

> Модуль: `02-tenant`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `02-tenant`
- Что нужно сделать:
  - завести таблицы `tenants`, `tenant_settings`, `tenant_access_state_events`, `tenant_closure_jobs`;
  - зафиксировать состояния `tenant.status`, `tenant.access_state`, связи с membership и owner;
  - предусмотреть поля под `closed_at`, retention lifecycle, access-state history и runtime warnings;
  - описать миграционный порядок без поломки текущего auth/bootstrap контекста.
- Критерий закрытия:
  - схема БД соответствует `02-tenant`;
  - AccessState и lifecycle состояния описаны и реализуемы без серых зон;
  - миграции воспроизводимы.

**Что сделано**

- Не выполнено.
