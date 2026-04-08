# TASK_FINANCE_7 — QA, Regression и Observability

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_FINANCE_1`
  - `TASK_FINANCE_2`
  - `TASK_FINANCE_3`
  - `TASK_FINANCE_4`
  - `TASK_FINANCE_5`
  - `TASK_FINANCE_6`
- Что нужно сделать:
  - покрыть тестами полный расчет, missing cost, missing fees, missing logistics, stale reports, rebuild flow;
  - проверить, что отсутствие `ads / tax / returns` помечает строку как incomplete, но не скрывает ее;
  - добавить кейс блокировки rebuild в `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - покрыть запрет ручного ввода периодных расходов;
  - завести метрики и алерты по snapshot failures, incomplete warnings, stale-source mass state, cost profile updates.
- Критерий закрытия:
  - регрессии по формулам и policy-block сценариям ловятся автоматически;
  - observability показывает проблемы completeness, freshness и rebuild;
  - QA matrix покрывает утвержденную MVP financial model.

**Что сделано**

- Не выполнено.
