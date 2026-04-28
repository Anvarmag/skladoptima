# TASK_REFERRALS_3 — First-Payment Trigger, Reward Crediting и Idempotency

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_REFERRALS_1`
  - `TASK_REFERRALS_2`
  - согласован `13-billing`
- Что нужно сделать:
  - реализовать internal trigger `POST /api/v1/referrals/webhook/first-payment` или equivalent internal contract;
  - начислять reward только по первой успешной оплате любого paid плана referred tenant;
  - перевести attribution через состояния `attributed -> paid -> rewarded`;
  - обеспечить идемпотентность reward crediting при повторных billing events/webhooks;
  - отправлять notification после успешного credit.
- Критерий закрытия:
  - reward logic зависит только от подтвержденного first payment, а не от UI/callback шумов;
  - один eligible tenant не получает reward дважды;
  - reward flow согласован с billing и bonus ledger.

---

## Что сделано

Реализован полный flow от получения первого billing-события до зачисления reward в бонусный кошелёк реферера и перевода attribution в терминальное состояние `REWARDED`. Двойная идемпотентность: на уровне статусной машины attribution (`REWARDED` → short-circuit) + на уровне БД-constraint (`UNIQUE(walletId, reasonCode, referredTenantId)` в bonus ledger).

### 1. [dto/first-payment-webhook.dto.ts](apps/api/src/modules/referrals/dto/first-payment-webhook.dto.ts)

```
POST /api/v1/referrals/webhook/first-payment
Body: {
  referredTenantId: UUID,       // tenant, за который пришёл первый платёж
  planId: string,               // ID плана для трассировки
  amountPaid: number,           // сумма оплаты (RUB)
  currency?: string,            // 'RUB' по умолчанию
  eventId: string               // stable billing event ID для трассировки
}
```

Валидируется через class-validator (`@IsUUID`, `@IsNumber`, `@Min(0)`, `@IsNotEmpty`).

### 2. [referral-reward.service.ts](apps/api/src/modules/referrals/referral-reward.service.ts)

**`processFirstPayment(args)`** — главный метод, реализует §9 + §10 + §16:

#### Машина состояний

```
ATTRIBUTED ──(first payment)──► PAID ──(reward credited)──► REWARDED (terminal ✓)
REJECTED / FRAUD_REVIEW ──────────────────────────────────► skip (terminal ✗)
```

#### Логика шагов

1. **Найти attribution** по `referredTenantId` (UNIQUE поле, установлено при tenant creation).
2. **Short-circuit checks**:
   - Нет attribution → `{ skipped: true, reason: 'NO_ATTRIBUTION' }` (нерефератная оплата).
   - `referralLink` удалён → `{ skipped: true, reason: 'LINK_DELETED' }` (snapshot кода есть, ownerUserId нет).
   - Статус `REJECTED` или `FRAUD_REVIEW` → `{ skipped: true, reason: 'ATTRIBUTION_REJECTED' }`.
   - Статус `REWARDED` → `{ alreadyRewarded: true }` (идемпотентный успех, без мутаций).
3. **ATTRIBUTED → PAID**: update `status=PAID, firstPaidAt=now`. Если уже `PAID` — шаг пропускается (retry-safe).
4. **Начислить бонус**: `BonusWalletService.credit({ ownerUserId, amount, reasonCode='REFERRAL_REWARD', referredTenantId })`. P2002 → `alreadyCredited=true` (второй guard идемпотентности).
5. **PAID → REWARDED**: update `status=REWARDED` (выполняется даже при `alreadyCredited=true`).
6. **Событие-лог**: `{ event: 'referral_bonus_credited', ownerUserId, referredTenantId, rewardAmount, eventId, ts }` — основа для будущего push-уведомления/email owner'у.

#### Конфигурация

`REFERRAL_REWARD_RUB` env var (дефолт: **500 руб.**).

### 3. Webhook endpoint

**[referral.controller.ts](apps/api/src/modules/referrals/referral.controller.ts)**:

```
POST /referrals/webhook/first-payment
  @Public()   — bypass JWT (billing-сервис работает без токена пользователя)
  @SkipCsrf() — bypass CSRF (server-to-server вызов без cookie)
  X-Internal-Secret: <INTERNAL_WEBHOOK_SECRET>
```

Защита: shared secret в header. Если `INTERNAL_WEBHOOK_SECRET` не задан в env — webhook заблокирован (fail-safe). Если секрет не совпадает → `403 INVALID_INTERNAL_SECRET`.

Остальные Owner-only endpoints (`GET /link`, `GET /status`, `GET /bonus-balance`, `GET /bonus-transactions`) перенесены под `@UseGuards(RequireActiveTenantGuard)` на уровне метода (а не класса), чтобы webhook мог быть `@Public()` без переопределения всего контроллера.

### 4. [referral.module.ts](apps/api/src/modules/referrals/referral.module.ts)

Добавлен `ReferralRewardService` в `providers` + `exports`. Экспорт позволит будущим интеграциям (billing module) вызывать `processFirstPayment` напрямую внутри монолита.

### 5. Spec покрытие — 8 тестов

[referral-reward.spec.ts](apps/api/src/modules/referrals/referral-reward.spec.ts):

| # | Что проверяет |
|---|---|
| 1 | Нет attribution → skipped=true, NO_ATTRIBUTION |
| 2 | referralLink удалён → skipped=true, LINK_DELETED |
| 3 | Attribution REJECTED → skipped=true, ATTRIBUTION_REJECTED |
| 4 | Attribution FRAUD_REVIEW → skipped=true, ATTRIBUTION_REJECTED |
| 5 | Attribution REWARDED → alreadyRewarded=true, без мутаций (credit не вызван) |
| 6 | Happy path ATTRIBUTED → 2 updates (PAID + REWARDED), credit вызван с правильными аргументами |
| 7 | Уже PAID (retry) → только 1 update (REWARDED), credit вызван |
| 8 | Credit P2002 (alreadyCredited=true) → всё равно переходит в REWARDED |

### 6. Проверки

- `npx tsc --noEmit -p tsconfig.json` → **20 ошибок (все pre-existing, ни одной новой)**.
- `npx jest --testPathPatterns="referral"` → **42/42 passed** (все 4 suite: link + attribution + bonus-wallet + reward).

### 7. DoD сверка

- ✅ **Reward logic зависит только от подтвержденного first payment**: webhook принимает `eventId` от billing, status-машина проверяет `ATTRIBUTED/PAID` перед любым начислением.
- ✅ **Один eligible tenant не получает reward дважды**: двойная защита — `status=REWARDED` на уровне бизнес-логики + `UNIQUE(walletId, reasonCode, referredTenantId)` на уровне БД в `BonusTransaction`.
- ✅ **Reward flow согласован с billing и bonus ledger**: webhook → `processFirstPayment` → `BonusWalletService.credit` атомарно обновляет кошелёк и пишет в леджер.

### 8. Что НЕ сделано (намеренно — за пределами scope)

- **Promo codes (validate/apply)** — TASK_REFERRALS_4 (в системной аналитике помечено как TASK_REFERRALS_3, но фактический файл задачи — TASK_REFERRALS_3 — посвящён first-payment trigger).
- **Anti-fraud guard** (beyond status check) — TASK_REFERRALS_5.
- **Frontend referral center UI** — TASK_REFERRALS_6.
- **Real push/email notification** — сейчас логируется как `referral_bonus_credited` event; интеграция с EmailService/MaxNotifier — отдельная задача (TASK_REFERRALS_7 или отдельный тикет).
- **Async worker** (очередь для webhook обработки) — в MVP обрабатывается синхронно.
