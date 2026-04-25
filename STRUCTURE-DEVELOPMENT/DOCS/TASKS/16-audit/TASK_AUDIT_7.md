# TASK_AUDIT_7 — QA, Regression и Observability Audit

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUDIT_1`
  - `TASK_AUDIT_2`
  - `TASK_AUDIT_3`
  - `TASK_AUDIT_4`
  - `TASK_AUDIT_5`
  - `TASK_AUDIT_6`
- Что нужно сделать:
  - покрыть тестами inventory/team/catalog/support/auth audit scenarios из mandatory catalog;
  - проверить failed login security event, support action trace и redaction чувствительных полей;
  - покрыть RBAC кейсы для `OWNER/ADMIN/MANAGER/STAFF`;
  - проверить доступность history screen в `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - завести метрики и алерты по audit write failures, coverage drops, RBAC denials и security event volume.
- Критерий закрытия:
  - регрессии по immutable storage, RBAC и redaction ловятся автоматически;
  - observability показывает состояние audit coverage и write reliability;
  - QA matrix покрывает утвержденный MVP audit catalog.

**Что сделано**

- Не выполнено.
