# TASK_SYNC_7 — QA, Regression и Observability

> Модуль: `09-sync`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_SYNC_1`
  - `TASK_SYNC_2`
  - `TASK_SYNC_3`
  - `TASK_SYNC_4`
  - `TASK_SYNC_5`
  - `TASK_SYNC_6`
- Что нужно сделать:
  - покрыть тестами manual run, scheduled run, retry, partial success, failed, blocked;
  - проверить rate-limit, duplicate external event и conflict scenarios;
  - добавить кейсы `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` и blocked preflight;
  - проверить, что success items не создают лишнюю item-level трассу в MVP;
  - завести метрики и алерты по run duration, blocked reasons, failure rate, retry spikes.
- Критерий закрытия:
  - регрессии по sync policy и idempotency ловятся автоматически;
  - observability показывает реальную операционную картину sync;
  - QA matrix покрывает ключевые run paths и конфликтные сценарии.

**Что сделано**

- Не выполнено.
