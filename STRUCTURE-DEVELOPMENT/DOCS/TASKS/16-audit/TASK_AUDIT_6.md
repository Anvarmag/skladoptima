# TASK_AUDIT_6 — Frontend History, Detail Drill-Down и Investigation UX

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_AUDIT_4`
  - `TASK_AUDIT_5`
- Что нужно сделать:
  - доработать `/app/history` фильтрами, detail view и before/after diff;
  - показывать actor, domain, entity, request/correlation context и changed fields;
  - скрывать security/internal-only детали по RBAC;
  - оставить экран доступным только `OWNER/ADMIN`;
  - поддержать read-only UX в `TRIAL_EXPIRED / SUSPENDED / CLOSED`.
- Критерий закрытия:
  - пользователь быстро понимает кто, что и когда изменил;
  - drill-down достаточен для product/support расследований;
  - UI не раскрывает internal-only или чувствительные поля.

**Что сделано**

- Не выполнено.
