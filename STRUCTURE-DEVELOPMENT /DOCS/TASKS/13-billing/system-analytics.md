# Биллинг — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `13-billing`

## 1. Назначение модуля

Модуль управляет тарифами, подпиской tenant, trial, платежами, лимитами и состояниями доступа (`TRIAL_ACTIVE`, `ACTIVE_PAID`, `GRACE_PERIOD`, `SUSPENDED`).

### Текущее состояние (as-is)

- в текущем backend нет отдельного billing модуля, endpoint и UI страницы биллинга;
- коммерческий lifecycle tenant и access-state пока представлены как целевая модель документации;
- проверки лимитов, подписок и платежей еще не выражены как прикладной слой текущего продукта.

### Целевое состояние (to-be)

- billing должен закрывать планы, подписки, платежи, webhook lifecycle и usage/limits;
- tenant access-state обязан управляться через централизованную policy, а не разрозненные проверки;
- trial expiry, paid nonpayment и plan-limit policy должны маппиться в уже согласованные `tenant AccessState`, а не вводить вторую конкурирующую модель блокировок;
- billing и limits должны влиять на продукт предсказуемо через read-only и upgrade сценарии.


## 2. Функциональный контур и границы

### Что входит в модуль
- тарифные планы и ограничения;
- trial/subscription/payment lifecycle tenant;
- grace/suspended logic и управление доступом;
- limit enforcement в доменных create/write потоках;
- usage counters и limit evaluation;
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
| Tenant policy service | Применяет access-state mapping | Не должен зависеть от UI-решений |
| Support/Admin | Диагностирует billing incidents и действует только в рамках утвержденных support contracts | Не создает hidden billing overrides в MVP |

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

### Сценарий 4. Завершение trial
1. Trial заканчивается.
2. Tenant немедленно переводится в `TRIAL_EXPIRED`.
3. Tenant работает только в read-only режиме согласно уже утвержденной tenant policy.
4. Для возврата в active режим требуется оплата и успешный transition в `ACTIVE_PAID`.

### Сценарий 5. Смена плана при текущем превышении лимита
1. Owner выбирает более низкий план.
2. Система сравнивает текущий usage с лимитами нового плана.
3. Если новый план ниже текущего usage, применяется отдельная downgrade policy.
4. Existing данные не удаляются, но дальнейшее создание новых сущностей ограничивается по policy.

## 5. Зависимости и интеграции

- Tenant access-state
- Tenant lifecycle policy (`TRIAL_EXPIRED`, `ACTIVE_PAID`, `GRACE_PERIOD`, `SUSPENDED`, `CLOSED`)
- Payment provider (card + invoice)
- Notifications (trial/payment reminders)
- Team/Catalog/Marketplace Accounts (limit enforcement targets)
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

### Frontend поведение

- Текущее состояние: в текущих маршрутах web-приложения нет отдельной billing страницы.
- Целевое состояние: нужны billing page, usage/limits, payment state и grace/suspended UX.
- UX-правило: любое ограничение доступа должно сопровождаться объяснением причины и следующим действием для пользователя.
- UI должен различать `TRIAL_EXPIRED` и `GRACE_PERIOD`: trial expired означает immediate read-only, grace означает временно сохраненный доступ с риском скорой блокировки.
- В MVP `GRACE_PERIOD` для paid nonpayment фиксируется как `3 дня`.
- При `SUSPENDED` пользователь видит billing CTA и ограниченный read-only режим, согласованный с tenant policy.
- При `CLOSED` billing история может быть видна только в support/restore сценариях, но не как рабочий tenant.

## 8. Модель данных (PostgreSQL)

### `billing_plans`
- `id UUID PK`, `code VARCHAR(64) UNIQUE`, `name VARCHAR(128)`
- `price_month NUMERIC(12,2)`, `currency VARCHAR(3)`
- `max_products INT`, `max_marketplace_accounts INT`, `max_members INT`
- `trial_days INT NOT NULL DEFAULT 30`
- `is_public BOOLEAN`, `is_active BOOLEAN`

### `subscriptions`
- `id UUID PK`, `tenant_id UUID UNIQUE`
- `plan_id UUID FK billing_plans(id)`
- `state ENUM(trialing, active, past_due, cancelled, inactive)`
- `provider_customer_id VARCHAR(128) NULL`
- `trial_started_at`, `trial_ends_at`
- `current_period_start`, `current_period_end`
- `grace_ends_at TIMESTAMPTZ NULL`
- `auto_renew BOOLEAN`
- `created_at`, `updated_at`

### `payments`
- `id UUID PK`, `tenant_id UUID`, `subscription_id UUID`
- `provider VARCHAR(64)`, `provider_payment_id VARCHAR(128)`
- `status ENUM(pending, succeeded, failed, refunded)`
- `idempotency_key VARCHAR(128) NULL`
- `amount NUMERIC(12,2)`, `currency VARCHAR(3)`
- `failure_reason TEXT NULL`, `paid_at TIMESTAMPTZ NULL`
- `created_at`

### `billing_usage_counters`
- `id UUID PK`, `tenant_id UUID`, `plan_id UUID`
- `metric_code ENUM(products, marketplace_accounts, members)`
- `current_value INT NOT NULL DEFAULT 0`
- `effective_limit INT NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `UNIQUE(tenant_id, metric_code)`

### `subscription_events`
- `id UUID PK`, `tenant_id UUID`, `event_type`, `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. При создании tenant стартует trial (`30 days`) и access-state `TRIAL_ACTIVE`.
2. Owner выбирает план и инициирует платеж.
3. Webhook подтверждает оплату -> `subscriptions.state=active`, access-state `ACTIVE_PAID`.
4. Завершение trial без оплаты -> `TRIAL_EXPIRED` и immediate read-only согласно tenant policy.
5. Завершение paid периода без оплаты -> `GRACE_PERIOD`, затем по окончании grace -> `SUSPENDED`.
6. В `SUSPENDED` write-операции блокируются, остается billing/support/read-only.
7. Limit counters обновляются из доменных модулей и участвуют в create/write guards.

## 10. Валидации и ошибки

- Trial только один раз на tenant.
- Webhook верифицируется подписью провайдера.
- Изменение `tenant access state` не делается напрямую из billing UI, только через policy transition.
- `special access / support override` не входит в MVP runtime policy.
- Ошибки:
  - `FORBIDDEN: BILLING_MANAGE_OWNER_ONLY`
  - `CONFLICT: TRIAL_ALREADY_USED`
  - `CONFLICT: PLAN_LIMIT_REACHED`
  - `CONFLICT: DOWNGRADE_BLOCKED_BY_CURRENT_USAGE`
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
- Mapping `subscription -> tenant access state` воспроизводим и не противоречит tenant policy.
- MVP-коммерческие лимиты ограничены `products`, `marketplace_accounts`, `memberships`.

## 13. State machine подписки и доступа

### Subscription state
- `TRIALING`
- `ACTIVE`
- `PAST_DUE`
- `CANCELLED`
- `INACTIVE`

### Access state
- `TRIAL_ACTIVE`
- `TRIAL_EXPIRED`
- `ACTIVE_PAID`
- `GRACE_PERIOD`
- `SUSPENDED`

### Правило
- `subscription state` и `tenant access state` не одно и то же, но связаны явной mapping-логикой

### Mapping MVP
- `trialing + now < trial_ends_at` -> `TRIAL_ACTIVE`
- `trialing + now >= trial_ends_at` -> `TRIAL_EXPIRED`
- `active` -> `ACTIVE_PAID`
- `past_due + now < grace_ends_at` -> `GRACE_PERIOD`
- `past_due + now >= grace_ends_at` -> `SUSPENDED`
- `cancelled/inactive` сами по себе не равны `CLOSED`; закрытие tenant остается отдельным lifecycle решением
- `grace_ends_at = current_period_end + 3 days` для MVP

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

### Правило downgrade below usage
- downgrade не удаляет существующие данные;
- если текущий usage уже выше лимита нового плана, tenant сохраняет существующие сущности, но новые create-actions блокируются до приведения usage в лимит или повторного upgrade.

### MVP набор лимитов
- `products`
- `marketplace_accounts`
- `memberships`
- дополнительные коммерческие лимиты выносятся в future scope

## 15. Async и webhook flows

- payment webhook processing
- reminder jobs за `7/5/3/1` дней
- grace-to-suspended scheduler
- reconciliation job по зависшим платежам
- usage counters reconciliation jobs

## 16. Тестовая матрица

- Старт trial при создании tenant.
- Первая оплата и переход в `ACTIVE_PAID`.
- Завершение trial и переход в `TRIAL_EXPIRED`.
- Неуспешный платеж.
- Истечение периода и `GRACE_PERIOD`.
- Переход в `SUSPENDED`.
- Блокировка create при превышении лимита.
- downgrade ниже текущего usage не удаляет данные, но блокирует новые create.
- `GRACE_PERIOD` завершается ровно через `3 дня`.
- `special access` недоступен в MVP runtime.

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
- Usage counters и limit guards должны быть консистентны с фактическими данными модулей, иначе billing UX быстро потеряет доверие.

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
- Если billing начнет жить по своей state machine без учета уже утвержденного `TRIAL_EXPIRED` read-only, продуктовые модули быстро разойдутся в поведении.
- Если включить support override уже в MVP, коммерческие правила быстро перестанут быть предсказуемыми для пользователя и для команды.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю billing больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены tenant access-state mapping, usage counters и открытые решения по grace/special access/limit set | Codex |
| 2026-04-18 | Подтверждены `3-day` grace period, отказ от support override в MVP и базовый набор billing limits | Codex |
