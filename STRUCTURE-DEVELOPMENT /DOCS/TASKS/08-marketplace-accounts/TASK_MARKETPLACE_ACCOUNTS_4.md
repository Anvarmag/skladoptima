# TASK_MARKETPLACE_ACCOUNTS_4 — Diagnostics, Sync Health и Event Model

> Модуль: `08-marketplace-accounts`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_1`
  - `TASK_MARKETPLACE_ACCOUNTS_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/marketplace-accounts/:id/diagnostics`;
  - показывать отдельно `lifecycle`, `credential status`, `sync health`, `effective runtime state`;
  - хранить и отдавать `last_validation_error_*`, `last_sync_error_*`, `sync_health_reason`;
  - описать доменные события `marketplace_account_created`, `validated`, `validation_failed`, `deactivated`, `reactivated`;
  - не раскрывать в diagnostics чувствительные части credential payload.
- Критерий закрытия:
  - diagnostics помогает отличать auth-проблему от sync degradation и policy pause;
  - UI и support видят одни и те же безопасные диагностические поля;
  - event model пригодна для audit/notifications/worker integration.

**Что сделано**

- Не выполнено.
