# TASK_AUDIT_2 — Unified Audit Writer, Write Strategy и Coverage Contracts

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUDIT_1`
- Что нужно сделать:
  - реализовать unified internal audit writer;
  - закрепить write strategy: предпочтительно в той же транзакции, допустимо через reliable outbox;
  - исключить best-effort post-commit logging без гарантии доставки;
  - описать coverage contracts для доменных модулей по mandatory audit events;
  - подключить internal endpoint/contract для безопасной записи audit событий.
- Критерий закрытия:
  - audit write path надежен и не теряет критичные записи;
  - доменные модули используют единый структурированный writer;
  - coverage по critical actions контролируется централизованно.

**Что сделано**

- Не выполнено.
