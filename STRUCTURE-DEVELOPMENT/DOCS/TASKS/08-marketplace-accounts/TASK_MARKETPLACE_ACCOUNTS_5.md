# TASK_MARKETPLACE_ACCOUNTS_5 — Tenant-State Guards и Single-Active-Account Policy

> Модуль: `08-marketplace-accounts`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_2`
  - `TASK_MARKETPLACE_ACCOUNTS_3`
  - согласованы `02-tenant`, `09-sync`
- Что нужно сделать:
  - при `TRIAL_EXPIRED` блокировать `validate`, `reactivate`, `sync now` и любые внешние API actions;
  - при `TRIAL_EXPIRED` оставить доступными только внутренние операции `PATCH label` и `deactivate`;
  - при `SUSPENDED` и `CLOSED` перевести модуль в read-only diagnostic mode;
  - гарантировать запрет второго `active` account того же marketplace до деактивации текущего;
  - синхронизировать effective runtime policy с `sync`, `warehouses`, `orders`, `finance`.
- Критерий закрытия:
  - account behavior не расходится с tenant commercial/access policy;
  - нет серой зоны, где интеграция продолжает работать после блокировки tenant;
  - single-active-account rule соблюдается и в API, и в runtime.

**Что сделано**

- Не выполнено.
