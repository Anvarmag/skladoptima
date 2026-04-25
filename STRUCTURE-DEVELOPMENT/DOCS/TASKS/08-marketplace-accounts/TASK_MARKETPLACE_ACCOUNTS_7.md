# TASK_MARKETPLACE_ACCOUNTS_7 — QA, Regression и Observability

> Модуль: `08-marketplace-accounts`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_1`
  - `TASK_MARKETPLACE_ACCOUNTS_2`
  - `TASK_MARKETPLACE_ACCOUNTS_3`
  - `TASK_MARKETPLACE_ACCOUNTS_4`
  - `TASK_MARKETPLACE_ACCOUNTS_5`
  - `TASK_MARKETPLACE_ACCOUNTS_6`
- Что нужно сделать:
  - покрыть тестами create/update/validate/deactivate/reactivate и diagnostics;
  - проверить masked responses и отсутствие plaintext credential leakage в логах;
  - добавить кейсы `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` для account actions;
  - проверить конфликт создания второго active account на тот же marketplace;
  - завести метрики и алерты по validation failures, reconnect-needed rate и account pause reasons.
- Критерий закрытия:
  - регрессии по security и policy-block сценариям ловятся автоматически;
  - observability показывает реальную картину account health без раскрытия секретов;
  - QA matrix покрывает основные пути для `WB / Ozon / Yandex Market`.

**Что сделано**

- Не выполнено.
