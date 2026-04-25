# TASK_TENANT_7 — Frontend Tenant UX, Regression и Observability

> Модуль: `02-tenant`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_TENANT_2`
  - `TASK_TENANT_3`
  - `TASK_TENANT_5`
  - `TASK_TENANT_6`
- Что нужно сделать:
  - собрать tenant picker, current tenant summary, warnings и blocked state UX;
  - показать `TRIAL_EXPIRED`, `GRACE_PERIOD`, `SUSPENDED`, `CLOSED` с понятным объяснением доступных действий;
  - покрыть regression на create/switch/isolation/access-state/closed tenant restore;
  - проверить observability: transition events, cross-tenant denials, closure jobs, stuck states.
- Критерий закрытия:
  - tenant UX предсказуем и согласован с backend policy;
  - ключевые сценарии create/switch/read-only/closed подтверждены тестами;
  - support и расследование обеспечены telemetry и audit.

**Что сделано**

- Не выполнено.
