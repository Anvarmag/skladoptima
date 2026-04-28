# TASK_REFERRALS_4 — Promo Validation/Apply и Stack Rules

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_REFERRALS_2`
  - `TASK_REFERRALS_3`
  - согласован `13-billing`
- Что нужно сделать:
  - завести `promo_codes` и правила их применимости;
  - реализовать `POST /api/v1/promos/validate` и `POST /api/v1/promos/apply`;
  - валидировать `is_active`, `expires_at`, `used_count < max_uses`, applicable plans;
  - закрепить MVP stack rule: `promo` и `bonus` взаимно исключаемы;
  - возвращать понятный conflict при `PROMO_BONUS_STACK_NOT_ALLOWED`.
- Критерий закрытия:
  - promo validation/apply работает предсказуемо и быстро;
  - promo и bonus не комбинируются в обход коммерческих правил;
  - checkout получает прозрачный discount preview и причину отказа.

---

## Что сделано

Реализован полный lifecycle промокодов: модели БД, миграция, сервис с validate/apply логикой, REST контроллер, 15 unit-тестов.

### 1. Schema & Migration

**[schema.prisma](apps/api/prisma/schema.prisma)** — добавлены:

```prisma
enum DiscountType { PERCENT, FIXED }
enum PromoStackPolicy { EXCLUSIVE, COMBINABLE_WITH_BONUS }

model PromoCode {
  id                  String           @id @default(uuid())
  code                String           @unique @db.VarChar(32)
  discountType        DiscountType
  discountValue       Decimal          @db.Decimal(12, 2)
  stackPolicy         PromoStackPolicy @default(EXCLUSIVE)
  applicablePlanCodes String[]         // пусто = применим ко всем планам
  maxUses             Int?             // null = без лимита
  usedCount           Int              @default(0)
  expiresAt           DateTime?
  isActive            Boolean          @default(true)
  ...
  redemptions PromoRedemption[]
}

model PromoRedemption {
  id        String    @id
  promoId   String
  tenantId  String
  appliedAt DateTime  @default(now())
  @@unique([promoId, tenantId])  // один tenant не применяет промокод дважды
}
```

**[migration.sql](apps/api/prisma/migrations/20260428230000_promo_codes/migration.sql)** — аддитивная миграция:
- CREATE TYPE `DiscountType`, `PromoStackPolicy`
- CREATE TABLE `PromoCode` + UNIQUE(code)
- CREATE TABLE `PromoRedemption` + UNIQUE(promoId, tenantId) + INDEX(tenantId)
- FK: `PromoRedemption.promoId → PromoCode.id CASCADE`

### 2. [promo.service.ts](apps/api/src/modules/referrals/promo.service.ts)

#### `validate(code, planId, bonusSpend?)` — dry-run, без side effects

Правила валидации (в порядке проверки):
1. Промокод найден по коду (case-insensitive trim + toUpperCase) — иначе `PROMO_NOT_FOUND`
2. `isActive = true` — иначе `PROMO_INACTIVE`
3. `expiresAt < now` — иначе `PROMO_EXPIRED`
4. `usedCount < maxUses` (если maxUses задан) — иначе `PROMO_MAX_USES_REACHED`
5. `applicablePlanCodes` пустой ИЛИ содержит planId — иначе `PROMO_NOT_APPLICABLE`
6. **MVP stack rule §14**: `stackPolicy=EXCLUSIVE && bonusSpend > 0` → `PROMO_BONUS_STACK_NOT_ALLOWED`

Возвращает:
- `{ valid: true, promoId, discountType, discountValue, stackPolicy }` — можно применять
- `{ valid: false, conflictCode, conflictMessage }` — и что именно нарушено

#### `apply(code, planId, tenantId, bonusSpend?)` — применение в checkout

1. Прогоняет те же правила через `_findAndValidate` — бросает `ConflictException` при нарушении.
2. Проверяет `PromoRedemption` — если уже применял этот tenant → `alreadyApplied: true` (идемпотентность).
3. Атомарно в `$transaction`:
   - создаёт `PromoRedemption(promoId, tenantId)`;
   - инкрементирует `PromoCode.usedCount`.
4. Возвращает `{ applied: true, alreadyApplied, redemptionId, discountType, discountValue, stackPolicy }`.

### 3. [promo.controller.ts](apps/api/src/modules/referrals/promo.controller.ts)

```
POST /promos/validate
  @Public()  — доступен без авторизации (preview скидки до логина)
  Body: { code, planId, bonusSpend? }
  → всегда 200: { valid: true, ... } | { valid: false, conflictCode, conflictMessage }

POST /promos/apply
  @UseGuards(RequireActiveTenantGuard) + assertOwner (ROLE=OWNER)
  Body: { code, planId, bonusSpend? }
  → 200: { applied: true, alreadyApplied, redemptionId, discountType, discountValue }
  → 409: ConflictException при нарушении правил
```

### 4. [referral.module.ts](apps/api/src/modules/referrals/referral.module.ts)

`PromoService` и `PromoController` добавлены в `providers`, `controllers`, `exports`.

### 5. Spec покрытие — 15 тестов

[promo.spec.ts](apps/api/src/modules/referrals/promo.spec.ts):

| # | Сценарий |
|---|----------|
| 1 | Код не найден → valid=false, PROMO_NOT_FOUND |
| 2 | Промокод неактивен → valid=false, PROMO_INACTIVE |
| 3 | Промокод истёк → valid=false, PROMO_EXPIRED |
| 4 | usedCount >= maxUses → valid=false, PROMO_MAX_USES_REACHED |
| 5 | План не в applicablePlanCodes → valid=false, PROMO_NOT_APPLICABLE |
| 6 | EXCLUSIVE + bonusSpend > 0 → valid=false, PROMO_BONUS_STACK_NOT_ALLOWED |
| 7 | applicablePlanCodes=[] → применим ко всем, valid=true |
| 8 | Happy path PERCENT → valid=true, discountType=PERCENT |
| 9 | Happy path FIXED → valid=true, discountType=FIXED |
| 10 | COMBINABLE_WITH_BONUS + bonusSpend → valid=true (стек разрешён) |
| 11 | apply happy path → applied=true, alreadyApplied=false, $transaction вызван |
| 12 | apply уже применял → alreadyApplied=true, $transaction не вызван |
| 13 | apply EXCLUSIVE + bonusSpend → ConflictException PROMO_BONUS_STACK_NOT_ALLOWED |
| 14 | apply код не найден → NotFoundException PROMO_NOT_FOUND |
| 15 | apply инкрементирует usedCount в $transaction |

### 6. Проверки

- `npx prisma generate` → **OK** (новые типы `PromoCode`, `PromoRedemption` сгенерированы).
- `npx tsc --noEmit -p tsconfig.json` → **20 ошибок (все pre-existing, ни одной новой)**.
- `npx jest --testPathPatterns="referral|promo|bonus"` → **57/57 passed** (5 суит: link + attribution + bonus-wallet + reward + promo).

### 7. DoD сверка

- ✅ **Promo validation/apply работает предсказуемо**: 6 типов conflict errors с явными кодами.
- ✅ **Promo и bonus не комбинируются**: `stackPolicy=EXCLUSIVE` + `bonusSpend>0` → `PROMO_BONUS_STACK_NOT_ALLOWED` в validate И в apply.
- ✅ **Checkout получает прозрачный discount preview**: `POST /promos/validate` — dry-run @Public без side effects.
- ✅ **Идемпотентность apply**: UNIQUE(promoId, tenantId) на уровне БД + `alreadyApplied=true` на уровне сервиса.

### 8. Что НЕ сделано (намеренно — за пределами scope)

- **Применение промокода в checkout через billing** — DTO + webhook для 13-billing модуля (отдельная задача).
- **Admin API для создания/деактивации промокодов** — TASK_REFERRALS_6 или отдельный тикет.
- **Anti-fraud для промокодов** — TASK_REFERRALS_5.
- **Frontend UI промокода** — TASK_REFERRALS_6.
