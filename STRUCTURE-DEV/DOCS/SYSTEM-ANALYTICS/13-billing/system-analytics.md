# Биллинг — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль управляет тарифами, подпиской tenant, trial, платежами, лимитами и состояниями доступа (`TRIAL_ACTIVE`, `ACTIVE_PAID`, `GRACE_PERIOD`, `SUSPENDED`).

## 2. Функциональный контур и границы

### Что входит в модуль
- тарифные планы и ограничения;
- trial/subscription/payment lifecycle tenant;
- grace/suspended logic и управление доступом;
- limit enforcement в доменных create/write потоках;
- обработка provider webhooks и reconciliation.

### Что не входит в модуль
- бухгалтерия и юридически значимые первичные документы beyond agreed scope;
- CRM продаж и complex invoicing suite;
- индивидуальные ручные договоренности вне documented support flows;
- auth/tenant ownership logic.

### Главный результат работы модуля
- доступ tenant к продукту определяется прозрачным состоянием подписки, а платежные события и тарифные лимиты воспроизводимо влияют на разрешенные действия в системе.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner | Управляет тарифом и оплатой | Единственный actor с критичными billing-правами |
| Admin | Может видеть часть billing данных | Обычно без права оплачивать/менять план |
| Payment provider | Подтверждает платежный статус | Источник истины по payment result |
| Support/Admin | Назначает special access по процедуре | Любое override должно аудироваться |

## 4. Базовые сценарии использования

### Сценарий 1. Старт trial
1. При создании tenant создается trial subscription.
2. Tenant получает access-state `TRIAL_ACTIVE`.
3. План usage counters начинают считаться сразу.
4. Notifications получают schedule на reminders.

### Сценарий 2. Переход на paid
1. Owner выбирает план и инициирует платеж.
2. Сервис создает payment intent/checkout session.
3. Provider webhook подтверждает оплату.
4. Subscription state и tenant access-state обновляются транзакционно.
5. Ограничения тарифа начинают действовать по новому плану.

### Сценарий 3. Неуплата и блокировка
1. Период заканчивается без подтвержденной оплаты.
2. Tenant переводится в `GRACE_PERIOD`.
3. По окончании grace scheduler переводит tenant в `SUSPENDED`.
4. Write-операции блокируются по limit/access policy.

## 5. Зависимости и интеграции

- Tenant access-state
- Payment provider (card + invoice)
- Notifications (trial/payment reminders)
- Referrals/Promo (скидки/бонусы)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/billing/plans` | User | Доступные тарифы |
| `GET` | `/api/v1/billing/subscription` | Owner/Admin(read-only) | Текущая подписка |
| `POST` | `/api/v1/billing/subscription/activate` | Owner | Активировать тариф |
| `POST` | `/api/v1/billing/payments` | Owner | Инициировать оплату |
| `POST` | `/api/v1/billing/payments/webhook` | Public (signed) | Входящий webhook провайдера |
| `POST` | `/api/v1/billing/subscription/cancel` | Owner | Выключить автопродление |
| `GET` | `/api/v1/billing/usage` | Owner/Admin | Использование лимитов |
| `POST` | `/api/v1/billing/special-access` | SUPPORT_ADMIN | Назначить special free access |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/billing/payments \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"planId":"plan_pro","paymentMethod":"CARD","promoCode":"SPRING10"}'
```

```json
{
  "paymentId": "pay_...",
  "status": "PENDING",
  "checkoutUrl": "https://provider/checkout/..."
}
```

## 8. Модель данных (PostgreSQL)

### `billing_plans`
- `id UUID PK`, `code VARCHAR(64) UNIQUE`, `name VARCHAR(128)`
- `price_month NUMERIC(12,2)`, `currency VARCHAR(3)`
- `max_products INT`, `max_marketplace_accounts INT`, `max_members INT`
- `is_public BOOLEAN`, `is_active BOOLEAN`

### `subscriptions`
- `id UUID PK`, `tenant_id UUID UNIQUE`
- `plan_id UUID FK billing_plans(id)`
- `state ENUM(trialing, active, past_due, cancelled, inactive)`
- `trial_started_at`, `trial_ends_at`
- `current_period_start`, `current_period_end`
- `auto_renew BOOLEAN`
- `created_at`, `updated_at`

### `payments`
- `id UUID PK`, `tenant_id UUID`, `subscription_id UUID`
- `provider VARCHAR(64)`, `provider_payment_id VARCHAR(128)`
- `status ENUM(pending, succeeded, failed, refunded)`
- `amount NUMERIC(12,2)`, `currency VARCHAR(3)`
- `failure_reason TEXT NULL`, `paid_at TIMESTAMPTZ NULL`
- `created_at`

### `subscription_events`
- `id UUID PK`, `tenant_id UUID`, `event_type`, `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. При создании tenant стартует trial (`30 days`).
2. Owner выбирает план и инициирует платеж.
3. Webhook подтверждает оплату -> `subscriptions.state=active`, access-state `ACTIVE_PAID`.
4. По окончании периода без оплаты -> `GRACE_PERIOD` (1-2 дня) -> `SUSPENDED`.
5. В suspended write-операции блокируются, остается billing/support/read-only.

## 10. Валидации и ошибки

- Trial только один раз на tenant.
- Webhook верифицируется подписью провайдера.
- Ошибки:
  - `FORBIDDEN: BILLING_MANAGE_OWNER_ONLY`
  - `CONFLICT: TRIAL_ALREADY_USED`
  - `EXTERNAL_INTEGRATION_ERROR: PAYMENT_PROVIDER_ERROR`

## 11. Чеклист реализации

- [ ] Миграции plans/subscriptions/payments.
- [ ] Интеграция payment provider.
- [ ] Access-state transition policy.
- [ ] Limit guard middleware.
- [ ] Reminder jobs и webhook обработчики.

## 12. Критерии готовности (DoD)

- Подписка корректно управляет доступом tenant.
- Лимиты тарифа реально применяются.
- Платежный lifecycle полностью журналируется.

## 13. State machine подписки и доступа

### Subscription state
- `TRIALING`
- `ACTIVE`
- `PAST_DUE`
- `CANCELLED`
- `INACTIVE`

### Access state
- `TRIAL_ACTIVE`
- `ACTIVE_PAID`
- `GRACE_PERIOD`
- `SUSPENDED`

### Правило
- `subscription state` и `tenant access state` не одно и то же, но связаны явной mapping-логикой

## 14. Enforcement лимитов

### На MVP лимитируем
- `products`
- `marketplace_accounts`
- `memberships`

### Где применять
- в create-endpoints соответствующих модулей
- через общий `PlanLimitGuard` или policy service

### Что происходит при превышении
- existing data не удаляется
- create/write сверх лимита блокируется
- UI получает structured error с рекомендацией upgrade

## 15. Async и webhook flows

- payment webhook processing
- reminder jobs за `7/5/3/1` дней
- grace-to-suspended scheduler
- reconciliation job по зависшим платежам

## 16. Тестовая матрица

- Старт trial при создании tenant.
- Первая оплата и переход в `ACTIVE_PAID`.
- Неуспешный платеж.
- Истечение периода и `GRACE_PERIOD`.
- Переход в `SUSPENDED`.
- Блокировка create при превышении лимита.

## 17. Фазы внедрения

1. Plans + subscriptions + payments.
2. Payment provider + webhook verification.
3. Access-state transition engine.
4. Limit enforcement layer.
5. Reminder jobs и support overrides.

## 18. Нефункциональные требования и SLA

- Webhook processing должен быть идемпотентным и завершаться быстро: целевой `p95 < 500 мс` для ack, остальная тяжелая обработка — асинхронно.
- Изменение access-state после подтвержденной оплаты или истечения grace должно становиться эффективным не позже чем через `1 мин`.
- Billing-guards не должны ломать read-only и support-сценарии в suspended tenant.
- Любое денежное событие должно оставлять воспроизводимый trail с provider reference и внутренним correlation id.

## 19. Observability, логи и алерты

- Метрики: `payments_succeeded`, `payments_failed`, `trial_to_paid`, `grace_started`, `suspended_tenants`, `limit_block_hits`.
- Логи: webhook verification, subscription state transitions, billing guard denials, special-access overrides.
- Алерты: рост failed payments, stuck pending payment, массовый переход в grace/suspended, webhook signature failures.
- Dashboards: billing funnel, payment reliability board, access-state monitor, plan-limit pressure board.

## 20. Риски реализации и архитектурные замечания

- Подписка и access-state tenant нельзя моделировать как одно поле; это два связанных, но разных слоя.
- Нельзя считать оплату завершенной по callback из UI; только provider webhook/reconciliation.
- Limit enforcement должен быть централизован policy-слоем, а не копипастой по модульным endpoint.
- Special-access/support override требует жесткого audit, иначе модуль быстро станет непрозрачным коммерчески.
