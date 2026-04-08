# TASK_WAREHOUSES_4 — Alias, Labels и Local Enrichment

> Модуль: `07-warehouses`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `6h`
- Зависимости:
  - `TASK_WAREHOUSES_1`
  - `TASK_WAREHOUSES_3`
- Что нужно сделать:
  - реализовать `PATCH /warehouses/:warehouseId/metadata` для `alias_name` и `labels`;
  - запретить изменение `external_warehouse_id`, `warehouse_type`, `source_marketplace`, внешнего `name/city`;
  - хранить локальную метадату отдельно от sync-полей;
  - гарантировать, что sync не перетирает пользовательские `alias/labels`;
  - писать audit на изменение `alias_name` и `labels` с `metadata_updated_at/by`;
  - подготовить ограничения длины, формата и количества labels.
- Критерий закрытия:
  - пользователь может локально обогащать справочник без поломки external truth;
  - alias/labels сохраняются после очередного sync;
  - metadata update не меняет идентичность склада;
  - локальные изменения metadata трассируются через audit и служебные поля.

**Что сделано**

- Не выполнено.
