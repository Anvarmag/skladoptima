# TASK_CATALOG_5 — Source-of-Change Policy и Tenant-State Guards

> Модуль: `05-catalog`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_CATALOG_2`
  - `TASK_CATALOG_3`
  - `TASK_CATALOG_4`
  - согласованы `02-tenant`, `09-sync`
- Что нужно сделать:
  - закрепить `source_of_truth` и source-of-change policy между `manual`, `import`, `sync`;
  - не допускать silent overwrite master-полей через sync-layer;
  - заблокировать все catalog write-actions при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - одинаково применять guard ко всем entrypoint: UI, import, sync-driven flows;
  - диагностировать конфликт ручного изменения и import/sync update;
  - писать audit на create/update/delete/restore/import commit/manual mapping/duplicate merge.
- Критерий закрытия:
  - source-of-change работает как явная policy, а не как неявное поведение;
  - tenant-state guards одинаково защищают CRUD/import/mapping;
  - каталог не расходится с read-only политикой tenant;
  - audit trail позволяет разобрать ключевые catalog changes и source-of-change конфликты.

**Что сделано**

- Не выполнено.
