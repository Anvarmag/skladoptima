# TASK_ORDERS_3 — Internal State Machine и Status Mapping

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ORDERS_1`
  - `TASK_ORDERS_2`
- Что нужно сделать:
  - реализовать mapping внешних marketplace statuses во внутренние состояния;
  - закрепить внутренние статусы `IMPORTED`, `RESERVED`, `CANCELLED`, `FULFILLED`, `DISPLAY_ONLY_FBO`, `UNRESOLVED`;
  - для FBS в MVP считать business-critical только `RESERVED / CANCELLED / FULFILLED`;
  - сохранять `PACKED`, `SHIPPED` и аналоги только в `external_status`, без отдельного внутреннего lifecycle;
  - поддержать переход `UNRESOLVED -> RESERVED` после устранения причин блокировки.
- Критерий закрытия:
  - internal state machine соответствует системной аналитике и не конфликтует с inventory contracts;
  - пользователь видит понятный внутренний статус заказа;
  - промежуточные внешние статусы не усложняют MVP lifecycle.

**Что сделано**

- Не выполнено.
