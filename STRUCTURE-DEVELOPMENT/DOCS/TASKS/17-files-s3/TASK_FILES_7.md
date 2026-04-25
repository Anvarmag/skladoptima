# TASK_FILES_7 — QA, Regression и Observability Files

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_FILES_1`
  - `TASK_FILES_2`
  - `TASK_FILES_3`
  - `TASK_FILES_4`
  - `TASK_FILES_5`
  - `TASK_FILES_6`
- Что нужно сделать:
  - покрыть тестами успешный upload/confirm, unsupported format, file too large, cross-tenant access;
  - проверить replace main image и cleanup orphaned upload;
  - покрыть блокировки upload/replace в `TRIAL_EXPIRED` и access-url в `SUSPENDED/CLOSED`;
  - добавить кейсы broken object reference reconciliation;
  - завести метрики и алерты по upload failures, access denials, cleanup backlog и orphan detection.
- Критерий закрытия:
  - регрессии по tenant isolation, lifecycle cleanup и access policy ловятся автоматически;
  - observability показывает состояние upload/access/cleanup цепочки;
  - QA matrix покрывает утвержденную MVP file model.

**Что сделано**

- Не выполнено.
