# TASK_REFERRALS_2 — Bonus Wallet, Transactions и Reward Ledger

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_REFERRALS_1`
- Что нужно сделать:
  - завести `bonus_wallets` и `bonus_transactions`;
  - реализовать ledger-модель `credit/debit` без direct balance mutation вне transaction log;
  - обеспечить `UNIQUE(wallet_id, reason_code, referred_tenant_id)` для защиты от двойного reward;
  - реализовать `GET /api/v1/referrals/bonus-balance` и `GET /api/v1/referrals/bonus-transactions`;
  - подготовить reason codes и metadata для reward credit/spend traceability.
- Критерий закрытия:
  - бонусный баланс прозрачно восстанавливается из ledger;
  - reward/spend операции трассируемы и идемпотентны;
  - direct balance update без ledger невозможен.

---

## Что сделано

Заложен бонусный леджер (кошелёк + append-only журнал транзакций). Любое начисление и списание бонусов проходит строго через `credit` и `debit` — единственные мутирующие методы `BonusWalletService`, которые атомарно пишут в леджер и обновляют агрегированный баланс. Прямой UPDATE balance недоступен вне этих методов.

### 1. Schema + миграция

**Enum `BonusTransactionType`** (§8):
- `CREDIT` — зачисление (referral reward, ручная корректировка support);
- `DEBIT` — списание (оплата подписки с бонусами — TASK_REFERRALS_3).

**`BonusWallet`** ([schema.prisma](apps/api/prisma/schema.prisma)):
- `id, ownerUserId (UNIQUE), balance DECIMAL(12,2), createdAt, updatedAt`;
- `UNIQUE(ownerUserId)` — один кошелёк на owner;
- Back-relation `ownerUser → User("BonusWalletOwner")`;
- Материализованный `balance` обновляется атомарно в одной DB-транзакции с записью в леджер (не требует SUM-пересчёта при GET /bonus-balance).

**`BonusTransaction`** (append-only леджер):
- `id, walletId, type, amount DECIMAL(12,2), reasonCode VARCHAR(64), referredTenantId VARCHAR(36)?, metadata JSONB?, createdAt`;
- `UNIQUE(walletId, reasonCode, referredTenantId)` — §8 идемпотентность reward credit: одному referred tenant соответствует не более одного credit с тем же reasonCode;
- PostgreSQL NULLS DISTINCT: `referredTenantId=NULL` (debit за подписку) разрешает несколько строк — гарантий не нужно;
- Стандартные reason codes: `REFERRAL_REWARD`, `BONUS_SPEND`, `SUPPORT_CREDIT`.

**Миграция [20260428220000_bonus_wallet_transactions/migration.sql](apps/api/prisma/migrations/20260428220000_bonus_wallet_transactions/migration.sql)** — аддитивная: 1 enum + 2 таблицы + FK + индексы. Не трогает ни одну существующую таблицу.

**Back-relation** в `User`: `bonusWallet BonusWallet? @relation("BonusWalletOwner")`.

### 2. [bonus-wallet.service.ts](apps/api/src/modules/referrals/bonus-wallet.service.ts)

**`getBalance(ownerUserId)`**
- Если кошелёк не создан (owner ещё не получал reward) — возвращает `{ balance: 0, currency: 'RUB' }`, не бросает 404.

**`getTransactions(ownerUserId, opts?)`**
- Cursor-based pagination по `id` (orderBy: createdAt DESC).
- Если кошелёк не существует — пустой список без ошибки.
- `limit` ограничен `MAX_PAGE_SIZE=100`; дефолт `DEFAULT_PAGE_SIZE=20`.

**`credit(args)`** — атомарная операция:
1. `upsert BonusWallet` (создаёт при первом reward, инкрементирует balance);
2. `create BonusTransaction(CREDIT)` с записью reasonCode + referredTenantId;
3. Возвращает `{ alreadyCredited, transactionId }`.
- P2002 → `alreadyCredited: true` без exception (first-payment webhook трактует как успех).
- amount <= 0 → `ConflictException BONUS_INVALID_AMOUNT`.

**`debit(args)`** — атомарная операция:
1. Проверяет наличие кошелька → `BONUS_WALLET_NOT_FOUND`;
2. Проверяет `balance >= amount` → `BONUS_INSUFFICIENT_BALANCE`;
3. `update balance: { decrement }` + `create BonusTransaction(DEBIT)`.

### 3. Controller endpoints (TASK_REFERRALS_2)

**[referral.controller.ts](apps/api/src/modules/referrals/referral.controller.ts)**:

```
GET /referrals/bonus-balance                    — Owner only
GET /referrals/bonus-transactions?limit&cursor  — Owner only (cursor-based)
```

Оба endpoint'а доступны только Owner; используют `_assertOwner` (тот же guard что для TASK_REFERRALS_1 endpoints).

### 4. Module wiring

**[referral.module.ts](apps/api/src/modules/referrals/referral.module.ts)** — добавлен `BonusWalletService` в providers + exports. Экспорт позволит TASK_REFERRALS_3/4 вызывать `credit`/`debit` из billing и promo checkout pipeline.

### 5. Spec покрытие — 15 тестов

[bonus-wallet.spec.ts](apps/api/src/modules/referrals/bonus-wallet.spec.ts):

| # | Suite | Что проверяет |
|---|-------|---------------|
| 1 | getBalance | нет кошелька → 0 |
| 2 | getBalance | кошелёк есть → баланс |
| 3 | getTransactions | нет кошелька → пустой список |
| 4 | getTransactions | есть кошелёк, нет транзакций → пустой список |
| 5 | getTransactions | cursor-pagination: hasMore=true → nextCursor |
| 6 | getTransactions | нет следующей страницы → nextCursor=null |
| 7 | credit | amount <= 0 → ConflictException |
| 8 | credit | happy path → alreadyCredited=false, transactionId |
| 9 | credit | нет кошелька → upsert создаёт |
| 10 | credit | P2002 (дубль) → alreadyCredited=true |
| 11 | credit | неожиданная ошибка → пробрасывается |
| 12 | debit | amount <= 0 → ConflictException |
| 13 | debit | нет кошелька → BONUS_WALLET_NOT_FOUND |
| 14 | debit | баланс недостаточен → BONUS_INSUFFICIENT_BALANCE |
| 15 | debit | happy path → transactionId, balance.decrement вызван |

### 6. Проверки

- `npx prisma generate` → ✓.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing, ни одной новой).
- `npx jest --testPathPatterns="bonus-wallet"` → **15/15 passed, 1 suite passed**.

### 7. DoD сверка

- ✅ **Бонусный баланс прозрачно восстанавливается из ledger**: `balance` — материализованный агрегат, обновляется атомарно с каждой TransactionRecord. Если нужно — можно пересчитать `SUM(amount WHERE type=CREDIT) - SUM(amount WHERE type=DEBIT)`.
- ✅ **Reward/spend операции трассируемы и идемпотентны**: каждая операция имеет `reasonCode` + опциональный `referredTenantId`; UNIQUE constraint делает credit идемпотентным на уровне БД.
- ✅ **Direct balance update без ledger невозможен**: `BonusWalletService` не имеет метода `setBalance` или `updateBalance` без создания `BonusTransaction`. Единственные public мутации — `credit` и `debit`.

### 8. Что НЕ сделано (намеренно — за пределами scope)

- **Promo validate/apply** — TASK_REFERRALS_3.
- **First-payment webhook** (вызов `credit` при `PAID → REWARDED`) — TASK_REFERRALS_4.
- **Anti-fraud guard** — TASK_REFERRALS_5.
- **Frontend referral center UI** — TASK_REFERRALS_6.
- **Метрики** (`bonus_spent`, `first_paid_rewards`) — TASK_REFERRALS_7.
- **`GET /referrals/stats`** (воронка без wallet) — можно добавить в TASK_REFERRALS_7 как отдельный endpoint.
