# TASK_SYNC_2 — Manual Run API, Retry Flow и Lifecycle Statuses

> Модуль: `09-sync`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_SYNC_1`
- Что нужно сделать:
  - реализовать `POST /api/v1/sync/runs`, `GET /api/v1/sync/runs`, `GET /api/v1/sync/runs/:runId`;
  - реализовать `POST /api/v1/sync/runs/:runId/retry`;
  - ограничить MVP manual actions до `sync now` по account и `retry failed run`;
  - не выводить и не поддерживать `tenant full sync` в runtime surface MVP;
  - различать в API/response `failed` и `blocked by policy`.
- Критерий закрытия:
  - manual sync контур соответствует утвержденной MVP-модели;
  - retry создает новый run с `trigger_type=retry` и ссылкой на origin run;
  - lifecycle run прозрачен для UI и support.

**Что сделано**

- Не выполнено.
