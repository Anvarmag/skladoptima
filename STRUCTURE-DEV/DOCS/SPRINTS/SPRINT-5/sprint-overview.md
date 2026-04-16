# Sprint 5 — Worker Platform + Sync Engine — Обзор

> Даты: 27 мая – 9 июня 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Запустить асинхронную платформу задач и поверх нее — диагностируемый sync engine.

---

## Цель спринта

Собрать worker runtime с очередями, retry, recovery и scheduled jobs, а затем положить на него sync-runs, conflicts, diagnostics и manual retry/full sync сценарии.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 18. Worker | [18-worker](../../BUSINESS-REQUIREMENTS/18-worker/requirements.md) | [18-worker](../../SYSTEM-ANALYTICS/18-worker/system-analytics.md) |
| 09. Синхронизация | [09-sync](../../BUSINESS-REQUIREMENTS/09-sync/requirements.md) | [09-sync](../../SYSTEM-ANALYTICS/09-sync/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Worker queues, priorities, retries, dead-letter, scheduler
- [ ] Sync run model: run/items/conflicts, manual run, retry, full sync
- [ ] Diagnostics API и UI для run history/failures/conflicts
- [ ] Baseline adapters contract для pull/push orchestration
- [ ] Recovery model после restart/deploy

---

## Что НЕ входит в спринт

- полный order/business processing внутри sync
- финансовые и billing jobs
- пользовательские notifications channels

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Потеря job после рестарта | Med | High | Lease/requeue policy + recovery tests |
| “Один большой sync job” без checkpoints | Med | High | Делить run на этапы и item-level diagnostics |
| Неуправляемый retry storm | Med | Med | Error taxonomy и backoff limits |

---

## Зависимости

- Sprint 4 marketplace accounts
- Базовая инфраструктура очередей и scheduler
- Согласованный adapter contract на external sync calls

---

## Ссылки

- Задачи: [TASKS-SPRINT-5](../../TASKS/TASKS-SPRINT-5/tasks.md)
- Детальный план: [PLAN-SPRINT-5](../../PLAN/PLAN-SPRINT-5.md)
