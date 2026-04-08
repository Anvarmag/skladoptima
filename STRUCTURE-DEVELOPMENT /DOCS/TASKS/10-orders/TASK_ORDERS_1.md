# TASK_ORDERS_1 — Data Model, Ingestion Registry и Event Provenance

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `10-orders`
  - согласованы `09-sync`, `06-inventory`
- Что нужно сделать:
  - завести таблицы `orders`, `order_items`, `order_events`;
  - закрепить поля `marketplace_account_id`, `sync_run_id`, `marketplace_order_id`, `fulfillment_mode`, `internal_status`, `stock_effect_status`;
  - хранить `external_event_id` и provenance каждого входящего order event;
  - зафиксировать уникальности по `marketplace_order_id` и `external_event_id`;
  - предусмотреть `warehouse_id`, `match_status`, `processed_at`, `affects_stock`.
- Критерий закрытия:
  - модель данных полностью покрывает ingestion, timeline и stock-effect диагностику;
  - источник order event и связанный `sync_run` восстанавливаются без сырых логов;
  - FBS/FBO различия выражены в data model явно.

**Что сделано**

- Не выполнено.
