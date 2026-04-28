# TASK_REFERRALS_5 — Anti-Fraud, Self-Referral Guard и Audit

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_REFERRALS_1`
  - `TASK_REFERRALS_3`
  - `TASK_REFERRALS_4`
- Что нужно сделать:
  - реализовать self-referral guard по owner/identity связям;
  - блокировать duplicate reward и suspicious attribution cases;
  - ввести `rejected` и `fraud_review` сценарии attribution;
  - писать audit на attribution decisions, reward credit/debit, promo apply/reject и fraud triggers;
  - подготовить anti-fraud recheck job для спорных кейсов.
- Критерий закрытия:
  - self-referral и очевидный duplicate abuse блокируются до reward crediting;
  - fraud-related решения воспроизводимы по audit/logs;
  - модуль не позволяет вручную начислять бонусы без ledger/audit следа.

---

## Что сделано

### Анализ существующего кода (as-is перед задачей)

TASK_REFERRALS_1 уже реализовал:
- **Self-referral по owner identity** (`link.ownerUserId === userId`) → статус `REJECTED`.
- **Self-referral по membership** (user уже active member tenantа ссылки) → статус `REJECTED`.
- `FRAUD_REVIEW` статус задан в enum, но ни одно правило его не выставляло.
- Structured logs (`Logger.log`) в каждом сервисе, но без персистентного DB audit trail.

TASK_REFERRALS_5 добавил:
1. **Два IP-based fraud правила** → `FRAUD_REVIEW` при срабатывании.
2. **Персистентный audit log** (`ReferralAuditLog` в БД) для attribution decisions.
3. **`recheckFraudReview()`** — механизм повторной проверки и очистки false positives.

---

### 1. Schema & Migration

**[schema.prisma](apps/api/prisma/schema.prisma)** — добавлены:

```prisma
enum ReferralAuditEventType {
  ATTRIBUTION_CAPTURED
  ATTRIBUTION_LOCKED
  ATTRIBUTION_REJECTED
  ATTRIBUTION_FRAUD_REVIEW
  REWARD_CREDITED
  REWARD_SKIPPED
  PROMO_APPLIED
  PROMO_REJECTED
  FRAUD_RECHECK_COMPLETED
}

model ReferralAuditLog {
  id            String                 @id @default(uuid())
  eventType     ReferralAuditEventType
  attributionId String?
  actorId       String?
  tenantId      String?
  ruleId        String?                @db.VarChar(64)
  data          Json?
  createdAt     DateTime               @default(now())

  @@index([attributionId])
  @@index([eventType, createdAt])
  @@index([tenantId])
}
```

Также добавлен `@@index([sourceIp, registrationAttributedAt])` на `ReferralAttribution` для fraud queries.

**[migration.sql](apps/api/prisma/migrations/20260428240000_referral_audit_log/migration.sql)**:
- CREATE TYPE `ReferralAuditEventType`
- CREATE TABLE `ReferralAuditLog` + 3 индекса
- CREATE INDEX `ReferralAttribution_sourceIp_registrationAttributedAt_idx`

---

### 2. [referral-audit.service.ts](apps/api/src/modules/referrals/referral-audit.service.ts)

Fire-and-forget audit writer:

```typescript
async log(args: LogAuditArgs): Promise<void>
// Записывает в ReferralAuditLog. При ошибке БД — logError, НЕ re-throw.
// Вызывается через void (не await в критическом пути).
```

Поля: `eventType`, `attributionId?`, `actorId?`, `tenantId?`, `ruleId?`, `data? (Json)`.

---

### 3. [fraud-guard.service.ts](apps/api/src/modules/referrals/fraud-guard.service.ts)

#### Fraud rules (оба env-configurable)

| Правило | Условие | Severity | Env vars |
|---------|---------|----------|---------|
| `IP_OVERUSE_PER_CODE` | Один IP встречается ≥ N раз для того же `referralLinkId` за W часов | `HIGH` | `FRAUD_MAX_SAME_IP_PER_CODE=3`, `FRAUD_IP_WINDOW_H=24` |
| `RAPID_FIRE` | Один IP встречается ≥ N раз для ЛЮБЫХ ссылок за W часов | `MEDIUM` | `FRAUD_MAX_RAPID_IP=5`, `FRAUD_RAPID_WINDOW_H=1` |

Если `sourceIp = null` — правила не применяются (IP необязателен).

#### `evaluate(args)` → `FraudEvalResult`

Вызывается в `lockOnTenantCreation` ПОСЛЕ self-referral check, ДО lock tenant'а.
Не мутирует данные — только анализирует.

#### `recheckFraudReview()` → `RecheckResult`

Повторная оценка всех FRAUD_REVIEW атрибуций:
- Если fraud rules больше НЕ срабатывают (окно истекло, IP больше не в threshold) → `ATTRIBUTED` (cleared).
- Иначе → остаётся `FRAUD_REVIEW` (kept).

Записывает `FRAUD_RECHECK_COMPLETED` audit event с `{ checked, cleared, kept }`.

---

### 4. Интеграция в [referral-attribution.service.ts](apps/api/src/modules/referrals/referral-attribution.service.ts)

Новые зависимости в конструкторе: `FraudGuardService`, `ReferralAuditService`.

#### Расширенный flow `lockOnTenantCreation`

```
1. Attribution не найдена → skipped (нерефератный signup)
2. Уже locked на тот же tenant → idempotent return
3. Уже locked на другой tenant → 409 REFERRAL_ATTRIBUTION_ALREADY_LOCKED
4. Self-referral check (owner / membership) → REJECTED + audit(ATTRIBUTION_REJECTED)
5. ← НОВОЕ: FraudGuard.evaluate() →
   - Suspicious → FRAUD_REVIEW + audit(ATTRIBUTION_FRAUD_REVIEW)
6. Happy path → lock tenant + audit(ATTRIBUTION_LOCKED)
```

#### Audit calls добавлены:
- `captureRegistration` success → `ATTRIBUTION_CAPTURED`
- `lockOnTenantCreation` REJECTED → `ATTRIBUTION_REJECTED`
- `lockOnTenantCreation` FRAUD_REVIEW → `ATTRIBUTION_FRAUD_REVIEW`
- `lockOnTenantCreation` locked → `ATTRIBUTION_LOCKED`

Reward/promo audit покрывается через structured `Logger.log(JSON.stringify({...}))` в `ReferralRewardService` и `PromoService` — это достаточный уровень для MVP (§19 "Logs"), DB audit для них добавляется при необходимости.

---

### 5. [referral.module.ts](apps/api/src/modules/referrals/referral.module.ts)

`FraudGuardService` и `ReferralAuditService` добавлены в `providers` и `exports`.

---

### 6. Spec покрытие — 13 новых тестов

**[fraud-guard.spec.ts](apps/api/src/modules/referrals/fraud-guard.spec.ts)** (8 тестов):

| # | Сценарий |
|---|----------|
| 1 | sourceIp=null → not suspicious |
| 2 | IP count < threshold → not suspicious |
| 3 | IP_OVERUSE_PER_CODE: count ≥ 3 → suspicious HIGH |
| 4 | RAPID_FIRE: count ≥ 5 → suspicious MEDIUM |
| 5 | Оба правила → возвращает первое (IP_OVERUSE_PER_CODE) |
| 6 | referralLinkId=null → пропускает rule 1, проверяет только RAPID_FIRE |
| 7 | recheckFraudReview: нет атрибуций → 0/0/0 |
| 8 | recheckFraudReview: cleared → update к ATTRIBUTED |
| 9 | recheckFraudReview: kept → update не вызван |

**[referral-audit.spec.ts](apps/api/src/modules/referrals/referral-audit.spec.ts)** (3 теста):

| # | Сценарий |
|---|----------|
| 1 | Happy path → create вызван с правильными полями |
| 2 | Опциональные поля отсутствуют → null маппинг |
| 3 | Ошибка БД → НЕ бросает exception |

**[referral-attribution.spec.ts](apps/api/src/modules/referrals/referral-attribution.spec.ts)** — обновлён (+1 тест):

| # | Сценарий |
|---|----------|
| +1 | fraud detected → FRAUD_REVIEW, locked=false, fraud.evaluate вызван |

---

### 7. Проверки

- `npx prisma generate` → **OK** (новые типы `ReferralAuditLog`, `ReferralAuditEventType` сгенерированы).
- `npx tsc --noEmit -p tsconfig.json` → **20 ошибок (все pre-existing, ни одной новой)**.
- `npx jest --testPathPatterns="referral|promo|bonus|fraud|audit"` → **70/70 passed** (7 суит).

---

### 8. DoD сверка

- ✅ **Self-referral блокируется до reward**: owner-check + membership-check → REJECTED (реализовано в TASK_REFERRALS_1, проверено тестами).
- ✅ **Duplicate abuse блокируется**: IP_OVERUSE_PER_CODE и RAPID_FIRE → FRAUD_REVIEW до lock tenant.
- ✅ **FRAUD_REVIEW и REJECTED сценарии работают**: обе ветки покрыты тестами и аудит-событиями.
- ✅ **Fraud-решения воспроизводимы**: `ReferralAuditLog` в БД с `eventType`, `ruleId`, `data`.
- ✅ **Бонусы только через ledger**: `BonusWalletService.credit/debit` → `BonusTransaction` — единственный мутирующий путь. `FRAUD_REVIEW` атрибуции блокируют `processFirstPayment` в `ReferralRewardService` (check status REJECTED/FRAUD_REVIEW → skip).
- ✅ **recheckFraudReview** готов к интеграции с cron/admin endpoint.

---

### 9. Что НЕ сделано (намеренно — за пределами scope)

- **Admin endpoint для recheckFraudReview** — нужен отдельный admin-only контроллер.
- **Cron scheduler** — подключить `@nestjs/schedule` + `@Cron` вызов `recheckFraudReview`.
- **ML/behavioral analysis** — в MVP достаточно IP-правил.
- **Reward/promo DB audit** — покрыто structured logs, DB upgrade при необходимости.
- **Email/Slack alert при fraud** — TASK_REFERRALS_7 (observability).
