# TASK_WAREHOUSES_3 — Read API, Filters и Stock-by-Warehouse Contract

> Модуль: `07-warehouses`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_WAREHOUSES_1`
  - `TASK_WAREHOUSES_2`
  - согласован `06-inventory`
- Что нужно сделать:
  - реализовать `GET /warehouses`, `GET /warehouses/:id`, `GET /warehouses/:id/stocks`;
  - поддержать фильтры по account, marketplace, type, status, source;
  - отдать inventory-friendly read-model с `warehouse_type`, `status`, `alias_name`, `labels`, `deactivation_reason`;
  - не открывать ручное создание/удаление складов через API в MVP;
  - обеспечить быстрый read API для справочника.
- Критерий закрытия:
  - warehouse directory читается как reference-справочник;
  - inventory может безопасно использовать warehouse read-model;
  - FBS/FBO визуально и логически не смешиваются.

**Что сделано**

- Не выполнено.
