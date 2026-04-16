# Sprint 9 — Billing + Limits + Access States — Обзор

> Даты: 22 июля – 4 августа 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Реализовать коммерческий слой подписки, платежей и тарифных ограничений.

---

## Цель спринта

Поднять тарифные планы, trial, subscription lifecycle, payments, grace/suspended режимы, limit enforcement и support override по правилам системной аналитики.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 13. Биллинг | [13-billing](../../BUSINESS-REQUIREMENTS/13-billing/requirements.md) | [13-billing](../../SYSTEM-ANALYTICS/13-billing/system-analytics.md) |
| 02. Мультитенантность | [02-tenant](../../BUSINESS-REQUIREMENTS/02-tenant/requirements.md) | [02-tenant](../../SYSTEM-ANALYTICS/02-tenant/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Plans/subscriptions/payments models и API
- [ ] Trial -> active -> grace -> suspended lifecycle
- [ ] Payment provider webhook + reconciliation
- [ ] Plan limit guard по products, marketplace accounts, members
- [ ] Billing UI и read-only behavior в suspended tenant

---

## Что НЕ входит в спринт

- реферальные скидки и бонусы
- marketing landing conversion
- полноценный invoicing suite

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Неверная связка subscription state и tenant access state | Med | High | Явная mapping policy и отдельные поля |
| Неидемпотентный webhook | Med | High | Provider signature + event dedup |
| Разрозненный limit enforcement | High | High | Единый `PlanLimitGuard` |

---

## Зависимости

- Sprint 1 tenant/access foundation
- Sprint 5 worker/scheduler
- Sprint 7 notifications baseline для reminders

---

## Ссылки

- Задачи: [TASKS-SPRINT-9](../../TASKS/TASKS-SPRINT-9/tasks.md)
- Детальный план: [PLAN-SPRINT-9](../../PLAN/PLAN-SPRINT-9.md)
