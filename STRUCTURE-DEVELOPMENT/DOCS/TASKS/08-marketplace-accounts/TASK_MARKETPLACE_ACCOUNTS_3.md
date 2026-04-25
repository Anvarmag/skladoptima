# TASK_MARKETPLACE_ACCOUNTS_3 — Validate, Reconnect, Deactivate/Reactivate Lifecycle

> Модуль: `08-marketplace-accounts`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_1`
  - `TASK_MARKETPLACE_ACCOUNTS_2`
- Что нужно сделать:
  - реализовать `POST /api/v1/marketplace-accounts/:id/validate`;
  - реализовать `POST /api/v1/marketplace-accounts/:id/deactivate` и `POST /api/v1/marketplace-accounts/:id/reactivate`;
  - закрепить переходы `ACTIVE/INACTIVE` и `VALIDATING/VALID/INVALID/NEEDS_RECONNECT/UNKNOWN`;
  - при `reactivate` запускать повторную validate, а не считать account рабочим автоматически;
  - записывать lifecycle events и audit на create/update/validate/deactivate/reactivate.
- Критерий закрытия:
  - жизненный цикл account воспроизводим и не конфликтует с системной аналитикой;
  - reconnect flow не теряет историю и не ломает ссылки на sync/warehouses;
  - credential validity не смешивается с operational sync health.

**Что сделано**

- Не выполнено.
