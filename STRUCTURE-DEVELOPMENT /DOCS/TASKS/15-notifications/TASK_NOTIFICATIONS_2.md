# TASK_NOTIFICATIONS_2 — Delivery Policy Engine, Mandatory Rules и Dispatch Orchestration

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_NOTIFICATIONS_1`
- Что нужно сделать:
  - реализовать внутренний dispatch orchestration pipeline;
  - закрепить policy types `instant`, `scheduled`, `throttled` для MVP;
  - исключить digest как пользовательскую функцию из MVP;
  - обеспечить, что mandatory `AUTH/BILLING/SYSTEM` alerts не могут быть полностью выключены preferences;
  - отделить доменные события от channel-specific dispatch decisions.
- Критерий закрытия:
  - delivery policy engine централизован и предсказуем;
  - mandatory alerts не теряются из-за пользовательских настроек;
  - MVP не усложняется digest-логикой.

**Что сделано**

- Не выполнено.
