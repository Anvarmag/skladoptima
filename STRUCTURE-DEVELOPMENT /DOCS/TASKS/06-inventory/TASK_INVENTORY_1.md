# TASK_INVENTORY_1 — Data Model, Balances, Movements и Settings

> Модуль: `06-inventory`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `06-inventory`
  - согласован `05-catalog`
- Что нужно сделать:
  - завести `stock_balances`, `stock_movements`, `inventory_effect_locks`, `inventory_settings`;
  - закрепить расчет `available = on_hand - reserved` как вычисляемое поле;
  - предусмотреть `movement_type`, `source_event_id`, `idempotency_key`, `reason_code`, actor/source tracing;
  - заложить warehouse scope и FBS/FBO границы в модель учета;
  - подготовить constraints и индексы для корректности остатков и idempotency.
- Критерий закрытия:
  - data model соответствует `06-inventory`;
  - balances и movements воспроизводимы для расследований;
  - schema готова к reserve/release/deduct без серых зон.

**Что сделано**

- Не выполнено.
