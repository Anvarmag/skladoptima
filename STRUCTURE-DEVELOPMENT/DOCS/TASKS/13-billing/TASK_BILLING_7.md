# TASK_BILLING_7 — QA, Regression и Observability

> Модуль: `13-billing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_BILLING_1`
  - `TASK_BILLING_2`
  - `TASK_BILLING_3`
  - `TASK_BILLING_4`
  - `TASK_BILLING_5`
  - `TASK_BILLING_6`
- Что нужно сделать:
  - покрыть тестами старт trial, first payment, failed payment, trial expiry, `GRACE_PERIOD`, `SUSPENDED`;
  - проверить, что `GRACE_PERIOD` завершается ровно через `3 дня`;
  - покрыть лимитные кейсы по `products`, `marketplace_accounts`, `memberships`;
  - добавить кейс downgrade ниже текущего usage без удаления данных;
  - завести метрики и алерты по webhook failures, payment reconciliation, grace expiries, limit blocks.
- Критерий закрытия:
  - регрессии по платежному lifecycle и access mapping ловятся автоматически;
  - observability показывает реальные проблемы webhook, limits и grace logic;
  - QA matrix покрывает утвержденную MVP billing policy.

**Что сделано**

- Не выполнено.
