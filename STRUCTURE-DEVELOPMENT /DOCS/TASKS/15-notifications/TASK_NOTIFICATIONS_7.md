# TASK_NOTIFICATIONS_7 — QA, Regression и Observability Notifications

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_NOTIFICATIONS_1`
  - `TASK_NOTIFICATIONS_2`
  - `TASK_NOTIFICATIONS_3`
  - `TASK_NOTIFICATIONS_4`
  - `TASK_NOTIFICATIONS_5`
  - `TASK_NOTIFICATIONS_6`
- Что нужно сделать:
  - покрыть тестами instant email verification, inbox creation, mandatory billing/security alerts;
  - проверить dedup одинаковых sync alerts и throttled low-stock scenarios;
  - добавить кейсы временного провайдера сбоя и retry;
  - проверить запрет на отключение всех каналов для mandatory alerts;
  - завести метрики и алерты по delivery latency, dispatch failures, dedup suppression и provider outage.
- Критерий закрытия:
  - регрессии по delivery policy, mandatory rules и dedup ловятся автоматически;
  - observability показывает event-to-dispatch-to-delivery цепочку;
  - QA matrix покрывает утвержденную MVP notification model.

**Что сделано**

- Не выполнено.
