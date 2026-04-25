# TASK_ORDERS_4 — Inventory Side-Effects и FBS/FBO Boundaries

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_ORDERS_2`
  - `TASK_ORDERS_3`
  - согласованы `06-inventory`, `07-warehouses`, `05-catalog`
- Что нужно сделать:
  - вызывать `inventory.reserve`, `inventory.release`, `inventory.deduct` только по допустимым FBS переходам;
  - передавать стабильный `source_event_id` и scope `tenant/product/warehouse`;
  - не применять stock-effect, если SKU не matched или warehouse scope не определен;
  - для FBO хранить заказ как `display-only`, `affects_stock=false`, `stock_effect_status=not_required`;
  - return events в MVP только логировать без auto-restock.
- Критерий закрытия:
  - FBS inventory-critical flow работает предсказуемо;
  - FBO не смешивается с управляемым stock контуром;
  - return policy соответствует утвержденной MVP модели.

**Что сделано**

- Не выполнено.
