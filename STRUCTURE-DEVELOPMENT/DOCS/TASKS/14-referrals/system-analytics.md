# Рефералы и промокоды — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `14-referrals`

## 1. Назначение модуля

Модуль реализует реферальную атрибуцию, одноразовое начисление бонуса после первой оплаты реферала, бонусный баланс owner и промокоды в checkout.

### Текущее состояние (as-is)

- в текущем backend и frontend нет отдельного реферального модуля и реферального центра пользователя;
- growth-механика атрибуции, бонусов и промокодов пока зафиксирована как проектная спецификация последнего спринта;
- интеграция с billing first-payment event пока отсутствует как прикладной контракт.

### Целевое состояние (to-be)

- referrals должны закрывать ссылки, атрибуцию, reward crediting, anti-fraud и promo lifecycle;
- реферальный контур должен быть связан с billing, но не смешивать reward logic с payment ledger;
- reward eligibility должен определяться по уже подтвержденной first paid подписке tenant, а не по UI/callback событиям;
- ростовые механики должны быть измеримы и управляемы как отдельный доменный слой.


## 2. Функциональный контур и границы

### Что входит в модуль
- генерация referral link/code;
- атрибуция реферала на регистрацию и tenant creation;
- promo-code validation and apply rules;
- начисление и списание бонусов/referral rewards;
- referral/promo stack rules;
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
| Auth/Registration | Передает attribution после signup | Не начисляет бонусы сам |
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

### Сценарий 4. Попытка self-referral
1. Пользователь приходит по своей referral link.
2. После регистрации/tenant creation сервис сравнивает identity и ownership связи.
3. Атрибуция помечается `rejected`.
4. Reward не начисляется, even if payment later succeeds.

## 5. Зависимости и интеграции

- Auth/Registration attribution
- Billing (first payment trigger)
- Notifications (bonus credited)
- Tenant/Owner identity
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
| `GET` | `/api/v1/referrals/status` | Owner | Статус referral profile и правил |
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

### Frontend поведение

- Текущее состояние: в текущих маршрутах нет страницы `/referrals` и referral center UI.
- Целевое состояние: нужны referral center, promo input и история бонусных операций.
- UX-правило: пользователь должен видеть как формируется бонус, за что он начислен и почему промокод отклонен.
- UI должен заранее объяснять stack rules: можно ли одновременно использовать referral reward и promo-code.
- Пользователь должен видеть, что reward начисляется только после первой успешной оплаты приглашенного tenant.
- В MVP reward eligible trigger = первая успешная оплата любого paid плана без дополнительных порогов.

## 8. Модель данных (PostgreSQL)

### `referral_links`
- `id UUID PK`, `owner_user_id UUID`, `tenant_id UUID`
- `code VARCHAR(32) UNIQUE`, `is_active BOOLEAN`
- `created_at`, `updated_at`

### `referral_attributions`
- `id UUID PK`, `referral_link_id UUID`, `referred_user_id UUID`, `referred_tenant_id UUID`
- `status ENUM(attributed, paid, rewarded, rejected, fraud_review)`
- `attributed_at TIMESTAMPTZ NOT NULL`
- `rejection_reason VARCHAR(64) NULL`
- `first_paid_at TIMESTAMPTZ NULL`
- `UNIQUE(referred_tenant_id)`

### `bonus_wallets`
- `id UUID PK`, `owner_user_id UUID UNIQUE`, `balance NUMERIC(12,2)`

### `bonus_transactions`
- `id UUID PK`, `wallet_id UUID`, `type ENUM(credit, debit)`
- `amount NUMERIC(12,2)`, `reason_code VARCHAR(64)`, `metadata JSONB`, `created_at`
- `UNIQUE(wallet_id, reason_code, (metadata->>'referred_tenant_id'))`

### `promo_codes`
- `id UUID PK`, `code VARCHAR(32) UNIQUE`
- `discount_type ENUM(percent, fixed)`, `discount_value NUMERIC(12,2)`
- `stack_policy ENUM(exclusive, combinable_with_bonus) NOT NULL DEFAULT 'exclusive'`
- `applicable_plan_codes TEXT[] NULL`
- `max_uses INT NULL`, `used_count INT DEFAULT 0`
- `expires_at TIMESTAMPTZ NULL`, `is_active BOOLEAN`

## 9. Сценарии и алгоритмы (step-by-step)

1. Owner получает/копирует referral link.
2. Новый пользователь регистрируется с `ref` параметром -> создается attribution после signup/tenant creation.
3. Атрибуция фиксируется один раз на referred tenant и не должна silently перезаписываться новым referral code.
4. При первой успешной оплате referral tenant internal billing event переводит attribution в `paid`, затем в `rewarded` и делает `credit` в wallet.
5. Бонус списывается только на оплату подписки tenant, где user = owner.
6. Self-referral, duplicate reward и invalid stack cases блокируются.

## 10. Валидации и ошибки

- `self-referral` запрещен.
- reward по одному referred tenant начисляется только 1 раз.
- Promo проверяет `expires`, `max_uses`, `is_active`, совместимость с планом.
- Комбинирование promo + bonus подчиняется `stack_policy`; по умолчанию в MVP промокод эксклюзивен и не сочетается с bonus spend.
- Reward eligible trigger в MVP = первая успешная оплата любого paid плана referred tenant.
- Ошибки:
  - `FORBIDDEN: SELF_REFERRAL_BLOCKED`
  - `CONFLICT: REFERRAL_ALREADY_REWARDED`
  - `CONFLICT: REFERRAL_ATTRIBUTION_ALREADY_LOCKED`
  - `CONFLICT: PROMO_BONUS_STACK_NOT_ALLOWED`
  - `CONFLICT: PROMO_NOT_APPLICABLE`

## 11. Чеклист реализации

- [x] Миграции referral таблиц (TASK_REFERRALS_1: `ReferralLink`, `ReferralAttribution`, enum `ReferralAttributionStatus`).
- [x] Referral attribution middleware для регистрации (TASK_REFERRALS_1: capture в `auth.register`, lock в `tenant.create`, attribution context — utm/sourceIp/userAgent).
- [x] Миграции wallet таблиц (TASK_REFERRALS_2: `BonusWallet`, `BonusTransaction`, enum `BonusTransactionType`, UNIQUE idempotency constraint).
- [x] Ledger credit/debit + GET /bonus-balance, GET /bonus-transactions (TASK_REFERRALS_2: BonusWalletService, cursor-pagination, atomic balance update).
- [x] Начисление бонуса по событию first payment (TASK_REFERRALS_3: ReferralRewardService, webhook POST /referrals/webhook/first-payment, статусная машина ATTRIBUTED→PAID→REWARDED, двойная идемпотентность).
- [x] Миграции promo таблиц (TASK_REFERRALS_4: `PromoCode`, `PromoRedemption`, enum `DiscountType`, `PromoStackPolicy`, UNIQUE(promoId, tenantId) идемпотентность apply).
- [x] Promo validate/apply (TASK_REFERRALS_4: PromoService.validate dry-run + apply атомарный; POST /promos/validate @Public; POST /promos/apply Owner; stack rule EXCLUSIVE; 15 unit-тестов).
- [x] Anti-fraud guard и аудит (TASK_REFERRALS_5: `FraudGuardService` — 2 IP правила (IP_OVERUSE_PER_CODE HIGH, RAPID_FIRE MEDIUM); `ReferralAuditService` fire-and-forget DB audit; `ReferralAuditLog` модель + миграция; интеграция в `lockOnTenantCreation` ПОСЛЕ self-referral check; `recheckFraudReview` для очистки false positives; 13 новых тестов (70/70 suite)).
- [x] Frontend Referral Center (TASK_REFERRALS_6: `ReferralCenter.tsx` — страница `/app/referrals` для Owner; персональная ссылка + copy; воронка статистики 4 метрики; блок правил growth UX; бонусный баланс + cursor-paged история транзакций; promo-валидатор debounce 600 мс с preview скидки + 7 explainable conflictCode сообщений + stackPolicy предупреждение; ограничение доступа по роли OWNER; навигационный пункт «Рефералы» Gift-иконка в sidebar и mobile-nav только для Owner).
- [x] QA Regression + Observability (TASK_REFERRALS_7: `ReferralMetricsService` — 8 track-методов структурированных JSON-событий (referral_attributed, first_paid_reward, duplicate_reward_attempt, self_referral_blocked, fraud_block, promo_validation_failed, bonus_spent, reward_skipped) + алерт-пороги в документации; `referral-metrics.spec.ts` — 11 тестов; `referral-regression.spec.ts` — 27 кросс-сервисных regression тестов (12 сценариев: FLOW-1..5, PROMO-1..4, LEDGER-1..2, ATTRIB-1); `ReferralModule` расширен ReferralMetricsService; итого 108/108 тестов (9 suites)).

## 12. Критерии готовности (DoD)

- Реферальный бонус начисляется строго один раз и идемпотентно.
- Промокоды корректно ограничиваются по правилам.
- Баланс бонусов прозрачно трассируется транзакциями.
- Атрибуция referral не перезаписывается после фиксации referred tenant.
- Reward logic не зависит от скрытых тарифных порогов: любой первый paid plan одинаково eligible в MVP.

## 13. Атрибуция referral на уровне регистрации

### Что сохранять в момент регистрации
- `referral_code`
- `utm_*`
- `source_ip`
- `user_agent`
- `registration_attributed_at`

### Где хранить
- в отдельной таблице attribution или прямо в `referral_attributions`

### Правило фиксации attribution
- в MVP attribution lock происходит на этапе успешной регистрации + tenant creation;
- после фиксации на `referred_tenant_id` ссылка/код уже не могут быть заменены другим referrer.

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
- `stack_policy` c referral bonus usage

### MVP stack rule
- в MVP промокод и бонусный баланс не комбинируются;
- если применен promo-code, bonus spend в этом checkout запрещен;
- если выбран bonus spend, promo-code validate/apply должен вернуть конфликт по stack rule.
- reward начисление и promo-скидка также не создают дополнительного "двойного бонуса" поверх одной и той же оплаты сверх зафиксированных правил.

## 15. Async и события

- `referral_attributed`
- `referral_first_payment_confirmed`
- `referral_bonus_credited`
- `referral_rejected`
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
- Повторная попытка приписать уже зафиксированный tenant к другому referral code.
- Первая успешная оплата любого paid плана триггерит reward.
- Промокод с истекшим сроком.
- Промокод с исчерпанным `maxUses`.
- Списание бонуса в checkout.
- Конфликт promo + bonus spend по stack rule.

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
- Attribution lock и reward crediting должны иметь явные idempotency keys/correlation ids, чтобы не зависеть от повторных callback/event delivery.

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
- Если разрешить свободное комбинирование promo и bonus в MVP без коммерческих guard-правил, unit economics будет трудно контролировать.
- Если reward eligibility завязать на скрытые пороги plan price, referral-механика станет непрозрачной для пользователя и support.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю referrals больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены attribution lock, stack rules и открытые решения по payment trigger и promo/bonus combinability | Codex |
| 2026-04-18 | Подтвержден first-paid trigger для reward и mutually exclusive правило для promo/bonus в MVP | Codex |
| 2026-04-28 | TASK_REFERRALS_1: заведены `ReferralLink` + `ReferralAttribution` + enum + миграция; двухэтапный attribution lock (capture в auth.register, lock в tenant.create); UNIQUE(referredTenantId) обеспечивает §13 запрет silent reassignment; self-referral check (owner === user / уже member); attribution context utm/sourceIp/userAgent; endpoints `GET /referrals/link` и `GET /referrals/status` (Owner only); 19 unit-тестов | Anvar |
| 2026-04-28 | TASK_REFERRALS_2: заведены `BonusWallet` + `BonusTransaction` + enum `BonusTransactionType` + миграция; ledger-модель credit/debit (атомарный upsert wallet + append-only transaction); UNIQUE(walletId, reasonCode, referredTenantId) для идемпотентности reward credit; cursor-pagination getTransactions; endpoints `GET /bonus-balance` и `GET /bonus-transactions` (Owner only); 15 unit-тестов | Anvar |
| 2026-04-28 | TASK_REFERRALS_3: `ReferralRewardService.processFirstPayment` — статусная машина ATTRIBUTED→PAID→REWARDED; двойная идемпотентность (status=REWARDED short-circuit + UNIQUE в BonusTransaction); webhook `POST /referrals/webhook/first-payment` (@Public+@SkipCsrf+X-Internal-Secret); DTO + secret guard; structured log `referral_bonus_credited`; REFERRAL_REWARD_RUB env (default 500); 8 unit-тестов (42/42 referral suite) | Anvar |
| 2026-04-28 | TASK_REFERRALS_4: `PromoCode` + `PromoRedemption` + enums `DiscountType`/`PromoStackPolicy` + миграция; `PromoService.validate` (dry-run, 6 типов конфликтов) + `PromoService.apply` (атомарный usedCount++ + PromoRedemption, идемпотентен); MVP stack rule EXCLUSIVE; `POST /promos/validate` @Public + `POST /promos/apply` Owner; `prisma generate` для новых типов; 15 unit-тестов (57/57 referral+promo suite) | Anvar |
| 2026-04-28 | TASK_REFERRALS_5: `FraudGuardService` — IP_OVERUSE_PER_CODE (HIGH) + RAPID_FIRE (MEDIUM) rules; интеграция в `lockOnTenantCreation` после self-referral check → FRAUD_REVIEW; `recheckFraudReview()` для повторной оценки false positives; `ReferralAuditService` fire-and-forget DB audit + `ReferralAuditLog` модель + enum `ReferralAuditEventType` + индекс sourceIp + миграция; audit calls в attribution decisions; 70/70 тестов (7 суит) | Anvar |
| 2026-04-28 | TASK_REFERRALS_6: `ReferralCenter.tsx` — страница `/app/referrals` (Owner-only); персональная ссылка с copy; воронка статистики (attributed/paid/rewarded/rejected); growth UX блок правил (5 пунктов, включая stack rule); бонусный баланс + cursor-paged история с иконками credit/debit; promo-валидатор debounce 600 мс + preview скидки + 7 conflictCode сообщений + stackPolicy EXCLUSIVE предупреждение; ограничение доступа по роли; Gift-навигация Owner-only в desktop sidebar + mobile-nav; маршрут `/app/referrals` в App.tsx | Anvar |
| 2026-04-28 | TASK_REFERRALS_7: `ReferralMetricsService` — 8 track-методов (referral_attributed, first_paid_reward, duplicate_reward_attempt, self_referral_blocked, fraud_block, promo_validation_failed, bonus_spent, reward_skipped) + `emit()` JSON+ts; `referral-metrics.spec.ts` 11 тестов; `referral-regression.spec.ts` 27 кросс-сервисных regression тестов (FLOW-1..5: lifecycle/idempotency/self-referral/any-plan/env; PROMO-1..4: maxUses/unlimited/stackRule/expiry; LEDGER-1..2: balance integrity/duplicate; ATTRIB-1: normalization); `ReferralModule` расширен; итого 108/108 тестов 9 суит | Anvar |
