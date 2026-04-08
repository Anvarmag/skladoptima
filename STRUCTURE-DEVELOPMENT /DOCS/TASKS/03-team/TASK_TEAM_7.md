# TASK_TEAM_7 — QA, Regression и Observability для Team

> Модуль: `03-team`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `7h`
- Зависимости:
  - `TASK_TEAM_2`
  - `TASK_TEAM_3`
  - `TASK_TEAM_4`
  - `TASK_TEAM_5`
  - `TASK_TEAM_6`
- Что нужно сделать:
  - собрать regression пакет на invite create/resend/cancel/accept, role change, remove, leave;
  - проверить existing/new user accept flow, invite email mismatch, expired/used token, last-owner guard;
  - покрыть `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` для team write-actions;
  - проверить observability: team events, invite email delivery, audit trail, expired invite cleanup.
- Критерий закрытия:
  - team контур закрыт проверяемой регрессией;
  - RBAC и ownership risks подтверждены тестами;
  - telemetry достаточна для расследования invite/member инцидентов.

**Что сделано**

- Не выполнено.
