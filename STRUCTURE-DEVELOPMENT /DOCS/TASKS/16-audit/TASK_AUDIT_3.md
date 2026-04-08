# TASK_AUDIT_3 — Security Events, Support/Admin Trace и Privileged Origin Markers

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_AUDIT_1`
  - `TASK_AUDIT_2`
  - согласованы `01-auth`, `19-admin`
- Что нужно сделать:
  - интегрировать security events `login_success`, `login_failed`, `password_reset_requested`, `password_changed`, `session_revoked`;
  - явно маркировать support/admin actions через `actor_type`, `actor_role`, `source`;
  - обеспечить, что privileged actions имеют отдельный audit след и не маскируются под обычного пользователя;
  - ограничить доступ к security/internal-only событиям по роли и visibility scope;
  - связать audit с support/admin contracts и auth/session events.
- Критерий закрытия:
  - support/admin trace легко отличим от tenant user operations;
  - security events структурированы и пригодны для расследований;
  - privileged origin markers не теряются в read model.

**Что сделано**

- Не выполнено.
