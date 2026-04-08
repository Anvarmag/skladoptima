# TASK_WAREHOUSES_1 — Data Model, Normalization и Lifecycle

> Модуль: `07-warehouses`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - утверждена системная аналитика `07-warehouses`
- Что нужно сделать:
  - завести таблицу `warehouses` с `tenant_id`, `marketplace_account_id`, `external_warehouse_id`, `warehouse_type`, `status`, `alias_name`, `labels`;
  - закрепить lifecycle `ACTIVE / INACTIVE / ARCHIVED`;
  - зафиксировать immutable external identity в рамках `(tenant, account, external_id)`;
  - предусмотреть `deactivation_reason`, `first_seen_at`, `last_synced_at`, `inactive_since`;
  - подготовить правила нормализации FBS/FBO и source marketplace.
- Критерий закрытия:
  - data model соответствует `07-warehouses`;
  - lifecycle склада формализован и воспроизводим;
  - reference layer не смешивается с inventory business logic.

**Что сделано**

- Не выполнено.
