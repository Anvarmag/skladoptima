# TASK_REFERRALS_7 — QA, Regression и Observability Referrals

> Модуль: `14-referrals`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_REFERRALS_1`
  - `TASK_REFERRALS_2`
  - `TASK_REFERRALS_3`
  - `TASK_REFERRALS_4`
  - `TASK_REFERRALS_5`
  - `TASK_REFERRALS_6`
- Что нужно сделать:
  - покрыть тестами успешную attribution, self-referral block, duplicate first-payment webhook, locked attribution;
  - проверить, что reward триггерится первой успешной оплатой любого paid плана;
  - покрыть promo expiry, max uses, not applicable plan, promo+bonus conflict;
  - проверить, что bonus spend и reward crediting не ломают ledger/idempotency;
  - завести метрики и алерты по referral funnel, duplicate reward attempts, fraud blocks, promo reject spikes.
- Критерий закрытия:
  - регрессии по attribution, reward idempotency и stack rules ловятся автоматически;
  - observability показывает состояние referral funnel, bonus ledger и anti-fraud;
  - QA matrix покрывает утвержденную MVP growth policy.

**Что сделано**

Добавлены три новых файла, завершающих QA-покрытие и observability модуля referrals. Весь suite: **108/108 тестов** (9 файлов), все зелёные.

---

### 1. `referral-metrics.service.ts` — Observability сервис

Новый `@Injectable() ReferralMetricsService` с 8 именованными методами метрик:

| Метод | Event name | Назначение |
|---|---|---|
| `trackAttributed` | `referral_attributed` | Воронка: attribution захвачена |
| `trackFirstPaidReward` | `first_paid_reward` | Успешный reward — growth KPI |
| `trackDuplicateRewardAttempt` | `duplicate_reward_attempt` | Аномалия billing-webhooks |
| `trackSelfReferralBlocked` | `self_referral_blocked` | Abuse-spike алерт |
| `trackFraudBlock` | `fraud_block` | Fraud-spike алерт |
| `trackPromoValidationFailed` | `promo_validation_failed` | Mass-reject алерт |
| `trackBonusSpent` | `bonus_spent` | Ledger flow metric |
| `trackRewardSkipped` | `reward_skipped` | Нерефератная оплата |

Каждый метод вызывает `emit()`, который логирует JSON-строку с полем `ts`. Log-агрегатор (ELK/Datadog/CloudWatch) подхватывает события и строит счётчики и алерты по thresholds. Встроен в `ReferralModule` как provider + export.

---

### 2. `referral-metrics.spec.ts` — 11 тестов

Покрывает все 8 track-методов + поведение `emit()`:
- JSON с полем `ts` — валидная ISO-дата текущего момента;
- каждый метод несёт правильный `event` и все обязательные поля;
- `sourceIp: null` корректно сериализуется в `fraud_block`.

---

### 3. `referral-regression.spec.ts` — 27 тестов (12 сценариев)

Regression QA-матрица MVP growth policy, кросс-сервисные сценарии:

| Группа | Сценарий | Проверяет |
|---|---|---|
| FLOW-1 | Полный lifecycle ATTRIBUTED → REWARDED | RewardService + WalletService вместе, wallet.upsert создаёт кошелёк |
| FLOW-2 | Дублированный webhook — idempotency | alreadyRewarded без мутаций; P2002 credit → всё равно REWARDED |
| FLOW-3 | Self-referral → reward skipped | Цепочка: captureRegistration → lockOnTenantCreation REJECTED → processFirstPayment skipped |
| FLOW-4 | Любой paid план триггерит reward | `plan_starter`, `plan_basic`, `plan_pro`, `plan_enterprise` — все дают reward |
| FLOW-5 | REFERRAL_REWARD_RUB env | дефолт=500; env=750 → rewardAmount=750 |
| PROMO-1 | maxUses граница | usedCount=maxUses−1 valid; usedCount=maxUses invalid; usedCount>maxUses invalid |
| PROMO-2 | maxUses=null | Неограниченный промокод valid при любом usedCount |
| PROMO-3 | Stack rule EXCLUSIVE | validate+apply оба блокируют bonusSpend; COMBINABLE оба разрешают |
| PROMO-4 | expiresAt граница | Будущее valid; прошедшее (−1 мс) PROMO_EXPIRED; null — никогда не истекает |
| LEDGER-1 | Balance integrity | credit(500)→debit(200)→balance=300; debit>balance → INSUFFICIENT; debit=balance разрешён |
| LEDGER-2 | Duplicate credit (P2002) | alreadyCredited=true, upsert вызван 1 раз |
| ATTRIB-1 | Code normalization | `code1234`, `Code1234`, ` CODE1234 ` → все нормализуются к `CODE1234` |
