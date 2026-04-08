# BILLING — Task Pack

> Модуль: `13-billing`
> Статус: [x] Подготовлено
> Основание: `DOCS/SYSTEM-ANALYTICS/13-billing/system-analytics.md`

---

## Состав

- `TASK_BILLING_1.md` — Plans, subscriptions, payments и usage counters data model
- `TASK_BILLING_2.md` — Payment provider, checkout и webhook lifecycle
- `TASK_BILLING_3.md` — Subscription-to-access mapping и grace/suspended policy
- `TASK_BILLING_4.md` — Plan limits, usage enforcement и downgrade behavior
- `TASK_BILLING_5.md` — Reminder jobs, reconciliation и support/admin boundaries
- `TASK_BILLING_6.md` — Frontend billing page, limits и access-state UX
- `TASK_BILLING_7.md` — QA, regression и observability billing

## Правила

- Каждый файл описывает отдельный инженерный блок.
- Чекбокс задачи закрывается только после заполнения блока `Что сделано`.
- Если задача переносится или дробится, это фиксируется внутри соответствующего файла.
- Порядок выполнения предполагается сверху вниз, если в файле не указано иное.
