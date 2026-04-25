# TASK_BILLING_4 — Plan Limits, Usage Enforcement и Downgrade Behavior

> Модуль: `13-billing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_BILLING_1`
  - `TASK_BILLING_3`
  - согласованы `03-team`, `05-catalog`, `08-marketplace-accounts`
- Что нужно сделать:
  - реализовать `GET /api/v1/billing/usage`;
  - собрать общий `PlanLimitGuard` или policy service для create/write flows;
  - применять лимиты только к `products`, `marketplace_accounts`, `memberships`;
  - реализовать downgrade policy: existing data не удаляется, но новые create-actions блокируются при usage above plan;
  - вернуть structured errors и upgrade guidance в UI/API.
- Критерий закрытия:
  - лимиты реально enforce-ятся в доменных create/write сценариях;
  - downgrade ниже текущего usage не ломает данные;
  - limit behavior согласован между billing и доменными модулями.

**Что сделано**

- Не выполнено.
