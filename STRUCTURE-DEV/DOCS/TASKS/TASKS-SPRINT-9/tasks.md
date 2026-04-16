# Tasks — Sprint 9 — Billing + Limits + Access States

> Спринт: 9
> Даты: 22 июля – 4 августа 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T9-01 | Реализовать plans/subscriptions/payments API | P0 | 12h | TODO |
| T9-02 | Реализовать trial/subscription/access-state transition engine | P0 | 10h | TODO |
| T9-03 | Реализовать payment provider webhook verification и reconciliation | P0 | 10h | TODO |
| T9-04 | Реализовать `PlanLimitGuard` и enforcement policy в create/write flows | P0 | 10h | TODO |
| T9-05 | Реализовать special-access/support override flow | P1 | 5h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T9-10 | Собрать billing UI: plans, subscription, payments, usage | P0 | 12h | TODO |
| T9-11 | Отобразить suspended/read-only UX и upgrade prompts | P0 | 6h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T9-20 | Создать таблицы `billing_plans`, `subscriptions`, `payments`, `subscription_events` | P0 | 5h | TODO |
| T9-21 | Добавить usage counters/read model для лимитов | P0 | 4h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T9-30 | Настроить secrets/webhook endpoint/payment env | P0 | 3h | TODO |
| T9-31 | Настроить schedules для reminders и grace->suspended jobs | P1 | 3h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T9-40 | Проверить trial/paid/grace/suspended state machine | P0 | 5h | TODO |
| T9-41 | Проверить payment success/fail/webhook idempotency | P0 | 5h | TODO |
| T9-42 | Проверить limit enforcement на products/accounts/members | P0 | 4h | TODO |
| T9-43 | Проверить read-only behavior и support override | P1 | 4h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 47 | |
| Frontend | 18 | |
| БД | 9 | |
| Инфра | 6 | |
| Тестирование | 18 | |
| **Итого** | **98** | |
