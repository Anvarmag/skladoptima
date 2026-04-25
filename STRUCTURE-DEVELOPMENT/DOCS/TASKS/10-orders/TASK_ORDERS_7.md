# TASK_ORDERS_7 — QA, Regression и Observability

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_ORDERS_1`
  - `TASK_ORDERS_2`
  - `TASK_ORDERS_3`
  - `TASK_ORDERS_4`
  - `TASK_ORDERS_5`
  - `TASK_ORDERS_6`
- Что нужно сделать:
  - покрыть тестами new FBS/FBO order, duplicate event, out-of-order event, cancel, fulfill, unmatched SKU;
  - добавить кейс `return_logged` без auto-restock;
  - проверить, что FBS order без warehouse scope не применяет stock-effect;
  - покрыть сценарии `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` для blocked external ingestion;
  - завести метрики по duplicate rate, unresolved orders, stock effect failures и timeline processing latency.
- Критерий закрытия:
  - регрессии по idempotency и inventory side-effects ловятся автоматически;
  - observability показывает реальные operational проблемы orders;
  - тестовая матрица покрывает утвержденную MVP state machine.

**Что сделано**

- Не выполнено.
