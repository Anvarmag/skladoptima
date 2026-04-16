# Биллинг — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять конверсию trial -> paid, устойчивость платежей, влияние лимитов тарифа на поведение tenant и эффективность сценариев grace/suspended/reactivation. Данные раздела используются для коммерческих решений и контроля потерь выручки.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Trial-to-Paid Conversion | Конверсия tenant из trial в оплату | >= 30% | `tenants_paid_after_trial / trial_tenants_ended` |
| Payment Success Rate | Успешные платежи | >= 95% | `successful_payments / payment_attempts` |
| Grace Exit to Paid | Выход из grace через оплату | >= 35% | `grace_to_paid / grace_started` |
| Suspended Reactivation Rate | Восстановление из `SUSPENDED` | >= 20% | `reactivated_suspended / suspended_tenants` |
| Limit Pressure Rate | Tenant, упершиеся в лимиты плана | <= 25% | `tenants_with_limit_blocks / active_tenants` |
| Churn After Trial | Отток после завершения trial | <= 45% | `trial_tenants_not_paid_30d / trial_tenants_ended` |

---

## 3. Воронки и конверсии

```
Trial started -> Reminder seen -> Payment initiated -> Payment success -> Active paid retained 30d
100%          -> 72%           -> 42%              -> 35%            -> 28%
```

Путь риска:

```
Paid period ended -> Grace started -> Suspended -> Reactivated
100%              -> 100%          -> 65%       -> 20%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Новый trial tenant | Быстро оценивает ценность | Ранний путь к первому результату и мягкий paywall |
| Active paid tenant | Стабильное использование | Прозрачная дата списания и лимиты |
| Grace tenant | Высокий риск оттока | Серия понятных напоминаний + быстрый re-pay |
| Special free access | Не проходит стандартную оплату | Отдельный контроль ROI сегмента |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `billing_trial_started` | Старт trial | `tenant_id`, `plan`, `trial_days` | High |
| `billing_reminder_sent` | Отправлено уведомление об окончании | `days_before_end`, `channel` | High |
| `billing_payment_initiated` | Инициирована оплата | `payment_method`, `plan` | High |
| `billing_payment_succeeded` | Успешный платеж | `amount`, `currency`, `plan` | High |
| `billing_payment_failed` | Ошибка платежа | `error_code`, `payment_method` | High |
| `billing_grace_started` | Переход в grace | `grace_days` | High |
| `billing_suspended` | Переход в suspended/read-only | `reason`, `days_after_expiry` | High |
| `billing_reactivated` | Восстановление доступа | `from_state`, `payment_method` | High |
| `billing_limit_blocked` | Блок на создание сущности из-за лимита | `limit_type`, `current_usage` | High |
| `billing_special_free_assigned` | Выдан special free access | `actor_role`, `reason` | Med |

---

## 6. Текущее состояние (baseline)

- Биллинг модуль в roadmap как отсутствующий; baseline строится с нуля после запуска платежного flow.
- Критичные baseline-метрики на запуске: `trial_to_paid`, `payment_fail_rate`, `grace_to_paid`.
- Для специальных бесплатных режимов требуется отдельный baseline бизнес-эффекта.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Напоминания за 7/5/3/1 день улучшат trial->paid | `Trial-to-Paid Conversion` | Идея |
| Прозрачный прогресс использования лимитов снизит внезапные блокировки | `Limit Pressure Rate`, `support_billing_tickets` | Идея |
| Кнопка `Оплатить в 1 клик` из suspended повысит reactivation | `Suspended Reactivation Rate` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Billing Funnel: trial, reminders, payments, paid retention.
- [ ] Payment Reliability: success/fail по способам оплаты.
- [ ] Access State Monitor: trial/grace/suspended/reactivated.
- [ ] Plan & Limits Usage: потребление лимитов и апгрейд-сигналы.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Падение trial->paid | `< 20%` | Ревизия ценностного пути и paywall-коммуникаций |
| Высокий payment fail | `> 8%` | Проверить платежный провайдер и UX формы оплаты |
| Много tenant в grace/suspended | `> 18%` | Усилить reminders и варианты оплаты |
| Частые блокировки лимитов на активных paid | `> 30% tenant` | Пересмотреть тарифные лимиты или апгрейд-flow |

---

## 11. Источники данных и правила расчета

- Источники: `billing_plans`, `subscriptions`, `payments`, `subscription_events`, limit-usage counters.
- Trial-to-paid считается по tenant, а не по user.
- `Grace Exit to Paid` должен считаться на cohort `grace_started`, без смешивания с прямыми paid renewals.
- Limit pressure требует join usage данных из catalog/team/marketplace modules.

---

## 12. Data Quality и QA-проверки

- Payment success/fail должны приходить только из verified provider webhook или reconciliation job.
- QA должна проверить trial start, successful payment, failed payment, grace, suspended, reactivation, limit enforcement.
- Один payment webhook не должен дважды переводить subscription state.
- `active paid` tenant не должен одновременно быть в `suspended` access-state.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: conversion trial -> paid и retention в billing.
- Revenue owner / finance ops: payment reliability и grace recovery.
- Backend lead: webhook idempotency, access-state transitions, limit guards.
- QA/Data: regression payments and subscription state machine, weekly billing health review.

---

## 14. Зависимости, допущения и границы

- Источником истины по платежному статусу является подтвержденный webhook или reconciliation, а не UI-ответ провайдера.
- Access-state tenant должен считаться отдельно от статуса платежной транзакции: один успешный payment не всегда означает немедленную смену подписки без пост-обработки.
- Все billing-метрики строятся на tenant-уровне, потому что коммерческая сущность продукта привязана к tenant, а не к отдельному пользователю.
- Бесплатные special-access сценарии должны быть отделены от классического trial, иначе они искажают conversion и churn.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
