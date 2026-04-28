# TASK_REFERRALS_1 — Referral Links, Attribution Model и Lock Policy

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `14-referrals`
  - согласованы `01-auth`, `02-tenant`, `20-landing`
- Что нужно сделать:
  - завести `referral_links` и `referral_attributions`;
  - реализовать сохранение attribution на этапе `registration + tenant creation`;
  - зафиксировать attribution lock по `referred_tenant_id` без silent reassignment другим referrer;
  - хранить attribution context: `referral_code`, `utm_*`, `source_ip`, `user_agent`, `registration_attributed_at`;
  - реализовать `GET /api/v1/referrals/link`, `GET /api/v1/referrals/status`.
- Критерий закрытия:
  - referral attribution переживает весь signup flow без потери источника;
  - attribution lock воспроизводим и не допускает перезаписи;
  - referral link/code работает как отдельный доменный объект, а не как ad-hoc параметр.

**Что сделано**

Заложен фундамент referrals domain — 2 новые таблицы + enum + миграция + 2 новых сервиса + 2 endpoint'а + 19 unit-тестов. MVP репозитория не имел отдельного referral модуля; теперь он работает как самостоятельный доменный слой, готовый к расширению bonus wallet (TASK_2/3) и first-payment trigger (TASK_4).

### 1. Schema + миграция

**Enum `ReferralAttributionStatus`** (5 состояний, §9 + §10):
- `ATTRIBUTED` — context зафиксирован при регистрации, tenant ещё не создан;
- `PAID` — tenant создан + первая успешная оплата (TASK_4);
- `REWARDED` — bonus credit зачислен (TASK_4);
- `REJECTED` — self-referral / fraud / invalid: reward никогда;
- `FRAUD_REVIEW` — спорный кейс на ручной разбор (TASK_5).

**`ReferralLink`** ([schema.prisma](apps/api/prisma/schema.prisma)):
- `id, ownerUserId, tenantId, code (UNIQUE), isActive, createdAt, updatedAt`;
- `UNIQUE(ownerUserId, tenantId)` — §6 «одна активная ссылка на (owner, tenant)» — даёт идемпотентность `getOrCreate`;
- `UNIQUE(code)` глобально — публичный токен не должен коллидировать.

**`ReferralAttribution`**:
- `id, referralLinkId (SET NULL), referralCode (snapshot), referredUserId (UNIQUE), referredTenantId (UNIQUE, nullable)`;
- `status, rejectionReason`;
- attribution context: `utmSource/Medium/Campaign/Content/Term, sourceIp, userAgent`;
- timestamps: `registrationAttributedAt, tenantLockedAt, firstPaidAt, createdAt, updatedAt`;
- `UNIQUE(referredUserId)` — один user — одна attribution (защита от перезаписи);
- `UNIQUE(referredTenantId)` — §13 attribution lock (NULLS DISTINCT даёт нам множественные NULL для ATTRIBUTED-без-tenant).

**Миграция [20260428200000_referrals_data_model/migration.sql](apps/api/prisma/migrations/20260428200000_referrals_data_model/migration.sql)** — аддитивная: 1 enum + 2 таблицы + FK + индексы. Не трогает `User / Tenant / Membership`.

**Wiring back-relations** в `User` (`ownedReferralLinks`, `referralAttributionsAsReferred`) и `Tenant` (`referralLinks`, `referralAttributions`).

### 2. [referral-link.service.ts](apps/api/src/modules/referrals/referral-link.service.ts)

- `getOrCreateForOwner({ownerUserId, tenantId})` — идемпотентный (UNIQUE), генерирует 8-символьный crockford-base32 код. Race-safe: при P2002 на (owner, tenant) читает существующую запись; при P2002 на code — retry до 5 раз.
- `findActiveByCode(code)` — case-insensitive lookup, возвращает null для пустых/неактивных. Используется attribution service'ом и публичной landing-страницей (TASK_LANDING).
- `getByCodeOrThrow(code)` — для internal API, кидает `404 REFERRAL_CODE_NOT_FOUND`.

### 3. [referral-attribution.service.ts](apps/api/src/modules/referrals/referral-attribution.service.ts) — двухэтапная attribution

**Этап 1: `captureRegistration({referralCode, referredUserId, utm_*, sourceIp, userAgent})`**
- валидирует код через `ReferralLinkService.findActiveByCode`;
- битый код / пустая строка → `captured=false, reason=INVALID_CODE`, БЕЗ exception (регистрация не должна падать из-за growth-механики);
- создаёт `ReferralAttribution(status=ATTRIBUTED, referredTenantId=null)`;
- P2002 на UNIQUE(referredUserId) → `ALREADY_CAPTURED`, возвращает существующий id.

**Этап 2: `lockOnTenantCreation({referredUserId, referredTenantId})`**
- attribution отсутствует → `skipped=true` (нерефератный signup);
- self-referral check: `link.ownerUserId === userId` ИЛИ user уже member `link.tenantId` → `REJECTED + SELF_REFERRAL_BLOCKED`. **Не ставим `referredTenantId`** — иначе owner не сможет создать ещё один tenant под своей ссылкой;
- happy path: `referredTenantId + tenantLockedAt = now`. UNIQUE даёт §13 lock policy;
- **idempotent**: уже locked на тот же tenant → `locked=true` без update;
- **conflict**: уже locked на ДРУГОЙ tenant → `409 REFERRAL_ATTRIBUTION_ALREADY_LOCKED` (§13 запрет silent reassignment).

**Read: `getOwnerStatus({ownerUserId, tenantId})`**
- агрегирует funnel `groupBy(status)` по ссылке владельца;
- возвращает MVP-правила (`rewardTrigger, rewardOncePerReferredTenant, selfReferralBlocked, attributionLockedOnTenantCreation, promoBonusStackPolicy`) — UI показывает их пользователю, чтобы он понимал, как формируется reward.

### 4. [referral.controller.ts](apps/api/src/modules/referrals/referral.controller.ts) — endpoints

```
GET /referrals/link    — Owner only (membership.role===OWNER)
GET /referrals/status  — Owner only
```

Read-only, доступны при paused tenant (referral ссылка должна оставаться валидной).

### 5. Wiring в auth и tenant pipeline

**[register.dto.ts](apps/api/src/modules/auth/dto/register.dto.ts)** — добавлены optional поля `referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm` (все с `MaxLength`).

**[auth.controller.ts](apps/api/src/modules/auth/auth.controller.ts) `register`** — берёт `sourceIp` (X-Forwarded-For first hop / req.ip) и `userAgent` server-side, передаёт в auth.service.

**[auth.service.ts](apps/api/src/modules/auth/auth.service.ts) `register`** — после успешного create user'а вызывает `referralAttributionService.captureRegistration` (only если `dto.referralCode`). Try/catch с soft warn — referral capture failure НЕ блокирует регистрацию.

**[tenant.service.ts](apps/api/src/modules/tenants/tenant.service.ts) `createTenant`** — после успешного create вызывает `referralAttributionService.lockOnTenantCreation` (fire-and-forget). Self-referral check, lock conflict, lock OK — все логируются как `referral_attribution_lock` event.

### 6. Spec покрытие — 19 тестов

[referral-link.spec.ts](apps/api/src/modules/referrals/referral-link.spec.ts) — **7 тестов**:

| # | Что проверяет |
|---|---|
| 1 | существующая ссылка → возвращает без create |
| 2 | нет ссылки → создаёт новую |
| 3 | race P2002 → читает уже созданную |
| 4 | findActiveByCode пустой/whitespace → null без БД |
| 5 | код не найден → null |
| 6 | isActive=false → null |
| 7 | case-insensitive lookup (lowercase в upper) |

[referral-attribution.spec.ts](apps/api/src/modules/referrals/referral-attribution.spec.ts) — **12 тестов**:

| # | Что проверяет |
|---|---|
| 1 | пустой/whitespace код → captured=false, INVALID_CODE |
| 2 | код не найден → captured=false, БЕЗ exception (soft fail) |
| 3 | happy path → создаёт attribution с context (utm/ip/ua) |
| 4 | повторный signup (P2002) → ALREADY_CAPTURED, возвращает существующий id |
| 5 | нет attribution → skipped=true (нерефератный signup) |
| 6 | self-referral по owner === user → REJECTED + НЕ ставим referredTenantId |
| 7 | self-referral по существующему membership → REJECTED |
| 8 | happy path → locked=true, tenantLockedAt установлен |
| 9 | уже locked на тот же tenant → idempotent, без update |
| 10 | уже locked на ДРУГОЙ tenant → 409 REFERRAL_ATTRIBUTION_ALREADY_LOCKED |
| 11 | getOwnerStatus: нет ссылки → hasLink=false, MVP правила |
| 12 | getOwnerStatus: funnel groupBy по статусам |

### 7. Проверки

- `npx prisma generate` → ✓.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing).
- `npx jest --testPathPatterns="referral"` → **19/19 passed, 2 suites passed**.
- Существующие auth + tenant спеки обновлены: добавлены stub `ReferralAttributionService` в providers (auth.service.spec уже улучшил статистику с baseline; tenant.service.spec остался с pre-existing 17 mock-related failures, не зависящими от моих изменений).

### 8. DoD сверка

- ✅ **Referral attribution переживает весь signup flow без потери источника**: capture происходит сразу после `user.create` в auth.service; tenant lock — после `tenant.create` в tenant.service. Промежуточные шаги (email verification, onboarding) НЕ трогают attribution — она остаётся в `ATTRIBUTED` пока tenant не создан.
- ✅ **Attribution lock воспроизводим и не допускает перезаписи**: UNIQUE на `referredTenantId` + проверка `attribution.referredTenantId !== args.referredTenantId` → 409 ALREADY_LOCKED. Покрыто spec'ами 9 и 10.
- ✅ **Referral link/code работает как отдельный доменный объект, а не как ad-hoc параметр**: `ReferralLink` — самостоятельная таблица + сервис + endpoint. `referralCode` денормализован в attribution snapshot'ом для аудита даже после удаления ссылки.

### 9. Что НЕ сделано (намеренно — за пределами scope)

- **Bonus wallets + transactions** — TASK_REFERRALS_2.
- **Promo codes (validate / apply)** — TASK_REFERRALS_3.
- **First-payment webhook trigger** для перевода attribution в `PAID` → `REWARDED` + bonus credit — TASK_REFERRALS_4.
- **Anti-fraud guard** (расширение beyond self-referral) — TASK_REFERRALS_5.
- **Frontend referral center UI** — TASK_REFERRALS_6.
- **Метрики/observability** (`referral_clicks`, `referral_attributed`, `first_paid_rewards`...) — TASK_REFERRALS_7.
- **Landing redirect handler** (`/r/:code` → set cookie + 302 на signup) — это `20-landing` задача.
- **`stats / bonus-balance / bonus-transactions / promos/validate / promos/apply / webhook/first-payment` endpoints** — последовательно в TASK_2/3/4.
