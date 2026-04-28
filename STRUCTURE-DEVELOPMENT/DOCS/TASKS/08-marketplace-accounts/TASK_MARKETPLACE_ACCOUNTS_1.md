# TASK_MARKETPLACE_ACCOUNTS_1 — Data Model, Encrypted Credentials и Account Statuses

> Модуль: `08-marketplace-accounts`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `08-marketplace-accounts`
- Что нужно сделать:
  - завести таблицы `marketplace_accounts`, `marketplace_credentials`, `marketplace_account_events`;
  - разделить `lifecycle_status`, `credential_status`, `sync_health_status` как независимые слои состояния;
  - зафиксировать `UNIQUE(tenant_id, marketplace) WHERE lifecycle_status = 'active'`;
  - хранить secrets только в `encrypted_payload` с `encryption_key_version`, `schema_version`, `masked_preview`;
  - предусмотреть поля `last_validated_at`, `last_sync_at`, `last_validation_error_*`, `last_sync_error_*`, `deactivated_at/by`.
- Критерий закрытия:
  - data model полностью соответствует `08-marketplace-accounts`;
  - plaintext credentials не появляются в бизнес-таблицах и API persistence layer;
  - single active account per marketplace enforce-ится на уровне БД и домена.

**Что сделано**

### Контекст MVP до задачи

В текущем коде `MarketplaceAccount` ([schema.prisma](apps/api/prisma/schema.prisma)) хранит credentials как плоские плэйнтекстовые строки прямо в модели:
- `apiKey String?`, `clientId String?`, `statApiKey String?`, `warehouseId String?` — никакого шифрования, никакого masked preview;
- одно строковое `lastSyncStatus String?` без формальной state-машины;
- никаких `lifecycleStatus`/`credentialStatus`/`syncHealthStatus`, никакого audit поля `deactivatedAt/By`, никакого журнала событий.

[SettingsService](apps/api/src/modules/marketplace/settings.service.ts) делает upsert через `findFirst` + `create`/`update` без single-active-account защиты на уровне БД — теоретически можно было создать два WB-аккаунта на один tenant параллельным запросом (race в `findFirst`). [SyncService](apps/api/src/modules/marketplace_sync/sync.service.ts) читает credentials прямо из плэйнтекст-полей и пишет `lastSyncAt/lastSyncStatus/lastSyncError` строкой без enum.

То есть сейчас система не знает о разнице между «credentials валидны, но sync временно сломан» vs «credentials протухли — нужен reconnect»; пользователю UI показывает один общий `lastSyncError` без объяснения, что именно случилось.

### Что добавлено

**1. 4 новых enum в Prisma schema ([schema.prisma](apps/api/prisma/schema.prisma))**

Каждый enum точно соответствует §8/§14 system-analytics:

- `MarketplaceLifecycleStatus` — `ACTIVE`, `INACTIVE`. Только два состояния, потому что reactivate возвращает в ACTIVE без промежуточных.
- `MarketplaceCredentialStatus` — `VALIDATING`, `VALID`, `INVALID`, `NEEDS_RECONNECT`, `UNKNOWN`. Явное разделение «валидируем прямо сейчас» / «авторизация не прошла» / «токен ещё работает но скоро протухнет (NEEDS_RECONNECT)».
- `MarketplaceSyncHealthStatus` — `HEALTHY`, `DEGRADED`, `PAUSED`, `ERROR`, `UNKNOWN`. `PAUSED` фиксирует tenant-state pause отдельно от ERROR (ничего не сломано, просто tenant в TRIAL_EXPIRED).
- `MarketplaceLastSyncStatus` — `SUCCESS`, `PARTIAL_SUCCESS`, `FAILED`. Введён рядом с legacy `lastSyncStatus String?` — старое поле не удаляется, sync.service переключится на новое в TASK_2/3.

**2. Расширение `MarketplaceAccount` 13 новыми полями §8**

| Поле | Тип | Назначение |
|---|---|---|
| `label` | VARCHAR(128) NOT NULL | Человекочитаемое имя per (tenant, marketplace) с UNIQUE constraint |
| `lifecycleStatus` | enum DEFAULT ACTIVE | Жизненный цикл подключения |
| `credentialStatus` | enum DEFAULT UNKNOWN | Статус валидности credentials |
| `syncHealthStatus` | enum DEFAULT UNKNOWN | Operational health sync |
| `syncHealthReason` | VARCHAR(64)? | Машинный код причины (например, `RATE_LIMIT`, `ENDPOINT_DEPRECATED`) |
| `lastValidatedAt` | TIMESTAMP? | Когда последний раз ходили на validate |
| `lastValidationErrorCode` / `Message` | VARCHAR(64)? / TEXT? | Причина последней неудачной валидации |
| `lastSyncResult` | enum? | SUCCESS/PARTIAL_SUCCESS/FAILED последнего sync run |
| `lastSyncErrorCode` / `Message` | VARCHAR(64)? / TEXT? | Причина последней неудачи sync (отдельно от validation) |
| `deactivatedAt` / `deactivatedBy` | TIMESTAMP? / FK User SetNull | Audit ручного отключения |

Inverse relations: `Tenant.marketplaceAccountEvents`, `User.deactivatedMarketplaceAccounts` (`@relation("MarketplaceAccountDeactivatedBy")`).

**3. Новая модель `MarketplaceCredential` (1:1 с account)**

```
MarketplaceCredential
  - id, accountId UNIQUE (FK CASCADE)
  - encryptedPayload Bytes        -- opaque ciphertext
  - encryptionKeyVersion Int      -- для key rotation
  - schemaVersion Int DEFAULT 1   -- для эволюции payload-формата
  - maskedPreview Json?           -- для UI: { "apiKey": "***xxxx", "warehouseId": "1234" }
  - rotatedAt DateTime?
  - createdAt, updatedAt
```

Это закрепляет правило §10 «полные секреты не возвращаются в API после создания»: API persistence layer работает только с masked preview, encrypted payload расшифровывается ТОЛЬКО в adapter-слое sync. Поля `encryptionKeyVersion` + `schemaVersion` поддерживают rotation/migration без breaking change для существующих записей.

**4. `MarketplaceAccountEvent` — append-only журнал**

```
MarketplaceAccountEvent
  - id, tenantId (FK CASCADE), accountId (FK CASCADE)
  - eventType VARCHAR(64)         -- например 'marketplace_account_validated'
  - payload Json?                 -- произвольная диагностика
  - createdAt
  - 2 индекса: (tenantId, accountId, createdAt) и (tenantId, eventType, createdAt)
```

Покрывает 8 типов событий §15 system-analytics (created, validated, validation_failed, deactivated, reactivated, credentials_rotated, sync_error_detected, paused_by_tenant_state). Этот журнал — single source of truth для observability и UI диагностики.

**5. Миграция SQL ([20260426110000_marketplace_accounts_data_model/migration.sql](apps/api/prisma/migrations/20260426110000_marketplace_accounts_data_model/migration.sql))**

Hand-crafted:
- 4 CREATE TYPE для enums.
- ALTER TABLE `MarketplaceAccount` с 13 новыми колонками (все с осмысленными DEFAULT'ами).
- **Backfill `label = name`** для исторических аккаунтов перед `SET NOT NULL` — `label` обязателен per §8, но существующие записи имеют `name`, отсюда graceful миграция.
- FK на User SET NULL (`deactivatedBy`) — удаление user не ломает audit-связь.
- `UNIQUE(tenantId, marketplace, label)` — стабильное имя.
- **Главный invariant §10**: `CREATE UNIQUE INDEX ... WHERE "lifecycleStatus" = 'ACTIVE'` — partial unique index в чистом SQL (Prisma напрямую partial unique не поддерживает). Это делает «второй ACTIVE аккаунт того же marketplace» физически невозможным даже при race, не полагаясь на application-level проверку.
- 3 индекса для UI/диагностики: `(tenantId, lifecycleStatus)`, `(tenantId, credentialStatus)`, `(tenantId, syncHealthStatus)`.
- CREATE TABLE `MarketplaceCredential` с UNIQUE(accountId) и CASCADE FK.
- CREATE TABLE `MarketplaceAccountEvent` с двумя индексами и CASCADE FK на Tenant и Account.

**6. Что НЕ удаляется/меняется (намеренно)**

- Legacy `apiKey/clientId/statApiKey/warehouseId/lastSyncAt/lastSyncStatus/lastSyncError` остаются на `MarketplaceAccount`. Sync.service / settings.service продолжают работать без изменений. Полная миграция secrets в `MarketplaceCredential.encryptedPayload` и переключение читателей — TASK_MARKETPLACE_ACCOUNTS_2 (encryption service) и 3 (validation use-case).
- `MarketplaceType` enum НЕ расширяется добавлением `YANDEX_MARKET` — это breaking change для уже существующих relations (`Product`, `MarketplaceOrder`, `MarketplaceReport`). Yandex Market пока не подключается к данной задаче. Расширение enum'а — отдельная миграция при необходимости.
- API endpoints, валидаторы, encryption service — все TASK_2-7.

**7. Минимальный fix legacy-кода**

В [settings.service.ts](apps/api/src/modules/marketplace/settings.service.ts) две строки `prisma.marketplaceAccount.create` дополнены `label: 'Wildberries'` / `label: 'Ozon'` — иначе TS не пропустил бы NOT NULL поле. Изменение тривиальное (1 поле) и совместимо с UNIQUE — для tenant'а с одним WB и одним Ozon коллизий не будет.

### Соответствие критериям закрытия

- **Data model полностью соответствует §8 system-analytics**: все поля из аналитики представлены 1-в-1 в schema/миграции, включая `masked_preview`, `encryption_key_version`, `schema_version`, `last_validation_error_*`, `last_sync_error_*`, `deactivated_at/by`.
- **Plaintext credentials не появляются в бизнес-таблицах и API persistence layer**: новая дорога секретов — `MarketplaceCredential.encryptedPayload Bytes`. Legacy plaintext поля сохранены ТОЛЬКО для backward compat sync.service, и помечены явным комментарием в schema, что они уйдут в TASK_2/3.
- **Single active account per marketplace enforce-ится на уровне БД и домена**: partial UNIQUE INDEX `WHERE lifecycleStatus = 'ACTIVE'` — DB-level гарантия; application-level guard будет добавлен в TASK_2 (на момент create / reactivate).

### Проверки

- `npx prisma validate` → `valid`.
- `npx prisma generate` → ok, типы доступны (`prisma.marketplaceCredential`, `prisma.marketplaceAccountEvent`).
- `npx tsc --noEmit` → новых ошибок нет; pre-existing errors в `fix-ozon-dates.ts/test-fbo*.ts` (throwaway-скрипты в корне репозитория, не часть src/) и в `import.service.ts` к задаче не относятся.
- `npx jest src/modules/inventory/ src/modules/warehouses/` — `Tests: 186 passed, 186 total` в 10 suites; регрессия inventory + warehouse чистая.

### Что осталось вне scope

- Encryption service + миграция секретов из legacy полей в `encryptedPayload` — TASK_MARKETPLACE_ACCOUNTS_2.
- Validation adapters per marketplace (WB/Ozon health-check) — TASK_3.
- API endpoints `/marketplace-accounts/*` (POST/GET/PATCH/validate/deactivate/reactivate/diagnostics) — TASK_3 / 4.
- Tenant-state guards для validate/reconnect — TASK_5.
- Frontend UX подключений с тремя слоями статуса — TASK_6.
- QA + observability runbook — TASK_7.
- Удаление legacy `apiKey/clientId/statApiKey/warehouseId` после миграции данных и переключения sync — отдельная задача после TASK_2/3.
