# TASK_BILLING_1 — Plans, Subscriptions, Payments и Usage Counters Data Model

> Модуль: `13-billing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - утверждена системная аналитика `13-billing`
  - согласованы `02-tenant`, `03-team`, `05-catalog`, `08-marketplace-accounts`
- Что нужно сделать:
  - завести `billing_plans`, `subscriptions`, `payments`, `billing_usage_counters`, `subscription_events`;
  - зафиксировать коммерческие лимиты MVP только для `products`, `marketplace_accounts`, `memberships`;
  - предусмотреть trial period, `grace_ends_at`, `auto_renew`, provider identifiers и idempotency fields;
  - обеспечить уникальность активной подписки tenant и корректную модель usage counters;
  - согласовать plan model с domain modules, которые будут проверять лимиты.
- Критерий закрытия:
  - data model покрывает планы, подписку, платежи и лимиты;
  - usage counters пригодны для централизованного limit enforcement;
  - модель не создает вторую конкурирующую систему access-state.

**Что сделано**

- Не выполнено.
