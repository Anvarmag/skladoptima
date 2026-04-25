# TASK_SYNC_1 — Data Model, Run Registry и Queue Orchestration

> Модуль: `09-sync`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - утверждена системная аналитика `09-sync`
  - согласованы `08-marketplace-accounts`, `18-worker`
- Что нужно сделать:
  - завести таблицы `sync_runs`, `sync_run_items`, `sync_conflicts`;
  - зафиксировать статусы `queued / in_progress / success / partial_success / failed / blocked / cancelled`;
  - реализовать `trigger_type`, `trigger_scope`, `origin_run_id`, `blocked_reason`, aggregated counters;
  - подготовить queue contract для worker с `run_id`, `job_key`, retry metadata;
  - закрепить правило, что success path в MVP хранится агрегатами в `sync_runs`, а не полным item-level логом.
- Критерий закрытия:
  - run registry покрывает lifecycle manual, scheduled и retry запусков;
  - модель данных пригодна для диагностики без прямого доступа к БД;
  - orchestration слой не блокирует HTTP и совместим с worker infrastructure.

**Что сделано**

- Не выполнено.
