# Sprint 5 — Billing + Subscriptions — Обзор

> Даты: 27 мая – 9 июня 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Тарифные планы, подписки, тарифные лимиты

---

## Цель спринта

Реализовать тарифную систему: TariffPlan, Subscription, AccessState-машину, лимиты в API и UI.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований |
|--------|----------------|
| Биллинг | [13-billing](../../BUSINESS-REQUIREMENTS/13-billing/requirements.md) |
| Мультитенантность | [02-tenant](../../BUSINESS-REQUIREMENTS/02-tenant/requirements.md) |
| Уведомления | [15-notifications](../../BUSINESS-REQUIREMENTS/15-notifications/requirements.md) |

---

## Ключевые deliverables

- [ ] TariffPlan и Subscription модели в Prisma
- [ ] AccessState-машина (TRIAL_ACTIVE → ACTIVE_PAID → GRACE_PERIOD → SUSPENDED)
- [ ] Тарифные лимиты в API guard
- [ ] Страница тарифов в UI
- [ ] Email при истечении триала

---

## Зависимости

- Sprint 1 и 2 завершены

---

## Ссылки

- Задачи: [TASKS-SPRINT-5](../../TASKS/TASKS-SPRINT-5/tasks.md)
- Детальный план: [PLAN-SPRINT-5](../../PLAN/PLAN-SPRINT-5.md)
