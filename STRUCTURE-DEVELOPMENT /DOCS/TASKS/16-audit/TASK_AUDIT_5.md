# TASK_AUDIT_5 — Before/After Policy, Redaction/Masking и Retention Rules

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_AUDIT_1`
  - `TASK_AUDIT_3`
  - `TASK_AUDIT_4`
- Что нужно сделать:
  - закрепить policy `summary diff + safe key fields` по умолчанию;
  - допускать полные `before/after` только для малых и безопасных сущностей;
  - исключить из payload чувствительные поля: `password`, `token`, `secret`, `apiKey`, `refreshToken`, verification tokens;
  - реализовать redaction/masking по RBAC для tenant-facing read model;
  - зафиксировать tenant-facing retention window = `180 дней`, без cold storage в MVP.
- Критерий закрытия:
  - sensitive values не попадают в audit trail и tenant UI;
  - before/after policy воспроизводима и не раздувает рискованные payload;
  - retention и masking semantics однозначны для MVP.

**Что сделано**

- Не выполнено.
