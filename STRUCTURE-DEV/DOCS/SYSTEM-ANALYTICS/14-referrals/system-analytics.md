# Рефералы и промокоды — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль реализует реферальную атрибуцию, одноразовое начисление бонуса после первой оплаты реферала, бонусный баланс owner и промокоды в checkout.

## 2. Функциональный контур и границы

### Что входит в модуль
- генерация referral link/code;
- атрибуция реферала на регистрацию и tenant creation;
- promo-code validation and apply rules;
- начисление и списание бонусов/referral rewards;
- anti-fraud проверки для self-referral и дублей.

### Что не входит в модуль
- полный affiliate network/partner portal;
- рекламная аналитика каналов beyond agreed attribution fields;
- биллинг-провайдер как источник истины по платежу;
- CRM nurture сценарии вне продукта.

### Главный результат работы модуля
- ростовые механики referral/promo встроены в продукт так, чтобы их можно было безопасно использовать без искажения выручки и без простого abuse.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Реферер | Делится ссылкой/кодом и получает reward | Reward только по правилам first paid |
| Новый tenant | Регистрируется и использует promo/referral | Не должен создавать self-referral bonus |
| Billing | Подтверждает eligibility через first payment | Важный внешний источник |
| Support/Growth | Смотрит fraud и кампании | Не должен вручную начислять без audit |

## 4. Базовые сценарии использования

### Сценарий 1. Регистрация по referral link
1. Пользователь приходит по referral URL.
2. Система сохраняет attribution в browser/session layer.
3. После регистрации и tenant creation referral связывается с новым tenant.
4. Reward еще не начисляется, пока нет first paid.

### Сценарий 2. Применение promo-code
1. Пользователь вводит promo при checkout или в разрешенной точке.
2. Backend валидирует срок действия, лимиты использования и stack rules.
3. В ответ возвращается discount preview.
4. После подтвержденной оплаты создается redemption record.

### Сценарий 3. Начисление referral bonus
1. Billing сообщает о первой успешной оплате реферала.
2. Referral service проверяет fraud rules и отсутствие предыдущего reward.
3. Создается bonus transaction для referrer.
4. Reward становится доступным к использованию по правилам кошелька.

## 5. Зависимости и интеграции

- Auth/Registration attribution
- Billing (first payment trigger)
- Notifications (bonus credited)
- Anti-fraud checks

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/referrals/link` | Owner | Получить персональную ссылку |
| `GET` | `/api/v1/referrals/stats` | Owner | Статистика приглашений |
| `GET` | `/api/v1/referrals/bonus-balance` | Owner | Баланс бонусов |
| `GET` | `/api/v1/referrals/bonus-transactions` | Owner | История начислений/списаний |
| `POST` | `/api/v1/promos/validate` | Public/User | Проверка промокода |
| `POST` | `/api/v1/promos/apply` | Owner | Применение промокода в оплате |
| `POST` | `/api/v1/referrals/webhook/first-payment` | Internal | Триггер начисления бонуса |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/promos/validate \
  -H "Content-Type: application/json" \
  -d '{"code":"SPRING10","planId":"plan_pro"}'
```

```json
{
  "valid": true,
  "discountType": "PERCENT",
  "discountValue": 10,
  "finalAmount": 8990
}
```

## 8. Модель данных (PostgreSQL)

### `referral_links`
- `id UUID PK`, `owner_user_id UUID`, `tenant_id UUID`
- `code VARCHAR(32) UNIQUE`, `is_active BOOLEAN`
- `created_at`, `updated_at`

### `referral_attributions`
- `id UUID PK`, `referral_link_id UUID`, `referred_user_id UUID`, `referred_tenant_id UUID`
- `status ENUM(attributed, paid, rewarded, rejected)`
- `first_paid_at TIMESTAMPTZ NULL`
- `UNIQUE(referred_tenant_id)`

### `bonus_wallets`
- `id UUID PK`, `owner_user_id UUID UNIQUE`, `balance NUMERIC(12,2)`

### `bonus_transactions`
- `id UUID PK`, `wallet_id UUID`, `type ENUM(credit, debit)`
- `amount NUMERIC(12,2)`, `reason_code VARCHAR(64)`, `metadata JSONB`, `created_at`

### `promo_codes`
- `id UUID PK`, `code VARCHAR(32) UNIQUE`
- `discount_type ENUM(percent, fixed)`, `discount_value NUMERIC(12,2)`
- `max_uses INT NULL`, `used_count INT DEFAULT 0`
- `expires_at TIMESTAMPTZ NULL`, `is_active BOOLEAN`

## 9. Сценарии и алгоритмы (step-by-step)

1. Owner получает/копирует referral link.
2. Новый пользователь регистрируется с `ref` параметром -> создается attribution.
3. При первой успешной оплате referral tenant — internal webhook переводит attribution в `rewarded` и делает `credit` в wallet.
4. Бонус списывается только на оплату подписки tenant, где user = owner.
5. Self-referral и повторное начисление блокируются.

## 10. Валидации и ошибки

- `self-referral` запрещен.
- reward по одному referred tenant начисляется только 1 раз.
- Promo проверяет `expires`, `max_uses`, `is_active`, совместимость с планом.
- Ошибки:
  - `FORBIDDEN: SELF_REFERRAL_BLOCKED`
  - `CONFLICT: REFERRAL_ALREADY_REWARDED`
  - `CONFLICT: PROMO_NOT_APPLICABLE`

## 11. Чеклист реализации

- [ ] Миграции referral/promo/wallet таблиц.
- [ ] Referral attribution middleware для регистрации.
- [ ] Начисление бонуса по событию first payment.
- [ ] Promo validate/apply в billing checkout.
- [ ] Anti-fraud guard и аудит.

## 12. Критерии готовности (DoD)

- Реферальный бонус начисляется строго один раз и идемпотентно.
- Промокоды корректно ограничиваются по правилам.
- Баланс бонусов прозрачно трассируется транзакциями.

## 13. Атрибуция referral на уровне регистрации

### Что сохранять в момент регистрации
- `referral_code`
- `utm_*`
- `source_ip`
- `user_agent`
- `registration_attributed_at`

### Где хранить
- в отдельной таблице attribution или прямо в `referral_attributions`

## 14. Логика промокодов

### Поддерживаемые типы
- `PERCENT`
- `FIXED`

### Что проверять при валидации
- `is_active`
- `expires_at`
- `used_count < max_uses`
- совместимость с `plan`
- ограничения по first payment / retention scenario

## 15. Async и события

- `referral_attributed`
- `referral_first_payment_confirmed`
- `referral_bonus_credited`
- `promo_validated`
- `promo_applied`
- `promo_rejected`

### Async
- начисление бонуса через worker после подтвержденного платежа
- anti-fraud recheck job для спорных кейсов

## 16. Тестовая матрица

- Успешная referral attribution.
- Self-referral блок.
- Двойной first-payment webhook.
- Промокод с истекшим сроком.
- Промокод с исчерпанным `maxUses`.
- Списание бонуса в checkout.

## 17. Фазы внедрения

1. Referral links + attribution.
2. Wallet + bonus transactions.
3. First-payment trigger and crediting.
4. Promo validation/apply.
5. Anti-fraud and audit layer.

## 18. Нефункциональные требования и SLA

- Referral attribution должна переживать редиректы и этапы регистрации без потери источника.
- Reward начисление выполняется идемпотентно: один eligible tenant не может получить reward дважды.
- Promo validation API должен отвечать быстро: `p95 < 300 мс`.
- Fraud checks должны выполняться до фактического reward-credit и быть воспроизводимыми по rule id/version.

## 19. Observability, логи и алерты

- Метрики: `referral_clicks`, `referral_attributed`, `first_paid_rewards`, `promo_validations_failed`, `fraud_blocks`, `bonus_spent`.
- Логи: attribution decisions, promo apply/reject reasons, reward credit/debit, fraud rule triggers.
- Алерты: всплеск self-referral, рост duplicate reward attempts, mass promo rejects, stuck reward processing.
- Dashboards: referral funnel, reward ledger health, fraud board, promo performance monitor.

## 20. Риски реализации и архитектурные замечания

- Если не зафиксировать единый момент атрибуции, growth-отчеты и вознаграждения быстро разойдутся.
- Reward должен быть связан с first paid tenant, а не с регистрацией пользователя, иначе abuse будет слишком дешевым.
- Stack rules promo + referral нужно описать до реализации checkout, а не “договориться позже”.
- Любые ручные корректировки бонусов должны идти через ledger/audit, а не direct balance update.
