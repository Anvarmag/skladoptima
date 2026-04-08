# TASK_ADMIN_4 — Internal Notes, Support Actions Log и Audit Integration

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_ADMIN_2`
  - `TASK_ADMIN_3`
  - согласован `16-audit`
- Что нужно сделать:
  - завести `support_actions` и `support_notes`;
  - реализовать `GET/POST /api/v1/admin/tenants/:tenantId/notes`;
  - сохранять `reason`, `payload`, `result_status`, `audit_log_id`, `correlation_id` для support actions;
  - позволить `SUPPORT_READONLY` видеть internal notes только в read-only модели;
  - связать notes/actions с общим audit trail.
- Критерий закрытия:
  - internal notes и support actions пригодны для handoff и расследований;
  - mutating и read-only support traces различимы;
  - audit linkage присутствует для всех high-risk действий.

**Что сделано**

- Не выполнено.
