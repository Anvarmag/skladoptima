# TASK_AUTH_7 — QA, Regression и Observability для Auth

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `7h`
- Зависимости:
  - `TASK_AUTH_2`
  - `TASK_AUTH_3`
  - `TASK_AUTH_4`
  - `TASK_AUTH_5`
  - `TASK_AUTH_6`
- Что нужно сделать:
  - собрать regression пакет на register/verify/login/logout/logout-all/reset/change password;
  - покрыть verify-blocked login, soft-lock, neutral errors, invite auto-link, revoke sessions;
  - проверить observability: auth events, security alerts, failed attempts, reset lifecycle;
  - зафиксировать smoke-checklist для релиза auth слоя.
- Критерий закрытия:
  - auth-контур закрыт проверяемой регрессией;
  - security-critical сценарии подтверждены тестами;
  - observability достаточна для поддержки и расследований.

**Что сделано**

- Не выполнено.
