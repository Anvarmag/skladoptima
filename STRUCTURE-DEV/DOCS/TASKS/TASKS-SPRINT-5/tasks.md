# Tasks — Sprint 5 — Billing + Subscriptions

> Спринт: 5
> Даты: 27 мая – 9 июня 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T5-01 | Создать BillingModule (TariffPlan, Subscription) | P1 | 4h | TODO |
| T5-02 | Сидирование тарифных планов в БД | P1 | 2h | TODO |
| T5-03 | AccessState-машина: переходы состояний | P0 | 5h | TODO |
| T5-04 | Guard: проверка тарифного лимита (maxProducts) | P1 | 3h | TODO |
| T5-05 | Guard: проверка лимита maхMarketplaceAccounts | P1 | 2h | TODO |
| T5-06 | Guard: проверка лимита maxMembers | P1 | 2h | TODO |
| T5-07 | API: GET /billing/plans — список тарифов | P1 | 1h | TODO |
| T5-08 | API: POST /billing/subscribe — оформить подписку | P1 | 3h | TODO |
| T5-09 | Cron: проверка истёкших подписок → GRACE_PERIOD | P1 | 3h | TODO |
| T5-10 | Cron: GRACE_PERIOD (5 дней) → SUSPENDED | P1 | 2h | TODO |
| T5-11 | Email при истечении триала (за 3 дня и в день) | P1 | 3h | TODO |

---

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T5-20 | Страница /app/billing — текущий тариф | P1 | 4h | TODO |
| T5-21 | Страница выбора тарифа | P1 | 5h | TODO |
| T5-22 | Banner: предупреждение о конце триала | P1 | 2h | TODO |
| T5-23 | Блокировка UI при SUSPENDED | P1 | 3h | TODO |

---

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T5-30 | Добавить TariffPlan, Subscription, SubscriptionStatus в schema.prisma | P0 | 3h | TODO |

---

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 30 | |
| Frontend | 14 | |
| БД | 3 | |
| **Итого** | **47** | |
