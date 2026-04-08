# TASK_ADMIN_2 — Tenant Directory, Tenant 360 и Summary Read-Model

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_ADMIN_1`
  - согласованы `02-tenant`, `08-marketplace-accounts`, `09-sync`, `18-worker`
- Что нужно сделать:
  - реализовать `GET /api/v1/admin/tenants` и `GET /api/v1/admin/tenants/:tenantId`;
  - собрать tenant directory с поиском по id/name/owner email;
  - построить tenant 360 на summary/read-model, а не на тяжелых ad hoc joins;
  - включить в tenant 360: team summary, subscription/access state, marketplace accounts, recent sync errors, notifications, worker status, files health, audit summary, notes;
  - обеспечить быстрый и безопасный internal read path.
- Критерий закрытия:
  - tenant 360 помогает диагностировать tenant без ручной реконструкции контекста;
  - summary layer быстрая и устойчивая;
  - internal read-model не смешивается с tenant-facing API.

**Что сделано**

- Не выполнено.
