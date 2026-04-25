# TASK_TENANT_4 — Tenant Isolation Guards и Access Enforcement

> Модуль: `02-tenant`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_TENANT_1`
  - `TASK_TENANT_3`
- Что нужно сделать:
  - внедрить middleware/guard на trusted `activeTenantId`;
  - проверять membership, tenant scope и access-state policy для write-sensitive операций;
  - зафиксировать правило `любой tenant-scoped объект обязан иметь tenant_id`;
  - исключить cross-tenant read/write и “общие” бизнес-сущности без scope.
- Критерий закрытия:
  - backend защищен от cross-tenant доступа;
  - write в tenant без membership технически невозможен;
  - tenant isolation одинаково работает во всех доменных модулях.

**Что сделано**

- Не выполнено.
