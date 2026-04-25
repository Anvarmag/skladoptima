# TASK_WORKER_3 — Retry/Backoff, Dead-Letter и Blocked-by-Policy Semantics

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_WORKER_1`
  - `TASK_WORKER_2`
  - согласованы `02-tenant`, `09-sync`
- Что нужно сделать:
  - реализовать retryable/non-retryable classification и backoff policy;
  - переводить policy-blocked jobs в `blocked` или `cancelled`, а не в `failed`;
  - уводить исчерпавшие попытки jobs в `failed` или `dead_lettered`;
  - вести `worker_failed_jobs` и failure snapshots;
  - отделить technical failures от domain policy failures на уровне статусов и diagnostics.
- Критерий закрытия:
  - `blocked by policy` диагностируется отдельно от инфраструктурных ошибок;
  - retry/dead-letter model воспроизводима и explainable;
  - финальные failure states пригодны для support и replay policy.

**Что сделано**

- Не выполнено.
