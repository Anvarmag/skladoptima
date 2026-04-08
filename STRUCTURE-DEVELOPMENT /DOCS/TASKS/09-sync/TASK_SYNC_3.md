# TASK_SYNC_3 — Preflight Checks, Tenant/Account Policy Guards

> Модуль: `09-sync`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_SYNC_1`
  - `TASK_SYNC_2`
  - согласованы `02-tenant`, `08-marketplace-accounts`
- Что нужно сделать:
  - реализовать preflight-check перед любым внешним вызовом;
  - проверять `tenant state`, `marketplace account lifecycle`, `credential status`, concurrency guard;
  - при `TRIAL_EXPIRED / SUSPENDED / CLOSED` переводить run в `blocked`, а не в `failed`;
  - запретить manual и scheduled внешний sync для paused/runtime-blocked account;
  - синхронизировать policy semantics с `inventory`, `orders`, `analytics`, `finance`.
- Критерий закрытия:
  - sync не идет во внешний API мимо tenant/account policy;
  - blocked-причины фиксируются явно и читаемо;
  - поведение модуля полностью согласовано с cross-module access rules.

**Что сделано**

- Не выполнено.
