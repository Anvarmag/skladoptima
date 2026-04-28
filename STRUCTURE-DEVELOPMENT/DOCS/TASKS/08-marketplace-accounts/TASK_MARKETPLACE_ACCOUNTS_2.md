# TASK_MARKETPLACE_ACCOUNTS_2 — Create/Update Account и Masked Credential Handling

> Модуль: `08-marketplace-accounts`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_1`
- Что нужно сделать:
  - реализовать `POST /api/v1/marketplace-accounts`;
  - реализовать `PATCH /api/v1/marketplace-accounts/:id` для `label` и частичного обновления credentials;
  - валидировать обязательные credential-поля в зависимости от marketplace;
  - обеспечить partial secret update без возврата старых значений в response;
  - отдавать только masked preview и безопасные metadata поля.
- Критерий закрытия:
  - создание и обновление account не раскрывает секреты;
  - response model безопасна и пригодна для UI;
  - ошибки `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` и `ACCOUNT_LABEL_ALREADY_EXISTS` отрабатывают предсказуемо.

**Что сделано**

### Контекст MVP до задачи

К моменту начала задачи в проекте уже была:
- Schema модель `MarketplaceAccount` со всеми статусными полями (TASK_1) + новые таблицы `MarketplaceCredential` и `MarketplaceAccountEvent`.
- DB-level enforce single-active через partial UNIQUE INDEX.
- Legacy [SettingsService](apps/api/src/modules/marketplace/settings.service.ts) с плэйнтекстовым upsert через flat DTO (`wbApiKey`, `ozonClientId`, `wbWarehouseId` etc.) — credentials хранятся прямо в `MarketplaceAccount.apiKey/clientId/...` без шифрования и без masked preview. Эта legacy-дорога не удаляется (sync.service её активно читает) — новый модуль работает параллельно.

Чего НЕ было:
- Encryption service для credentials.
- DTO/сервис создания/обновления через канонический REST API (`POST /marketplace-accounts`, `PATCH /marketplace-accounts/:id`).
- Валидация полей под marketplace (WB требует `apiToken/warehouseId`, Ozon — `clientId/apiKey/warehouseId`).
- Masked preview для UI.
- Application-level guard `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` / `ACCOUNT_LABEL_ALREADY_EXISTS` с человеческими error-кодами.

### Что добавлено

**1. Encryption service [credentials-cipher.service.ts](apps/api/src/modules/marketplace-accounts/credentials-cipher.service.ts)**

`CredentialsCipher` — симметричное шифрование AES-256-GCM:

- `encrypt(payload: object) → Buffer` формирует `[12 IV][16 tag][ciphertext]` для записи в `MarketplaceCredential.encryptedPayload Bytes`.
- `decrypt(blob) → object` инвертирует, бросает `MARKETPLACE_CREDENTIALS_DECRYPT_FAILED` (Internal Server Error, не пользовательская ошибка) на повреждённые данные / неверный ключ.
- `getCurrentKeyVersion()` — версия для `encryptionKeyVersion` (поддержка ротации, ENV `MARKETPLACE_CREDENTIALS_KEY_VERSION`).
- `maskValue(v)` — `'1234567890' → '***7890'`, `'abcd' → '***'`, пустая/null → null.

Ключ: ENV `MARKETPLACE_CREDENTIALS_KEY` (32 bytes base64). В dev-режиме fallback на детерминированный SHA-256 от sentinel (чтобы локальная разработка не падала); в production ENV обязателен.

**2. Schema validation [credential-schema.ts](apps/api/src/modules/marketplace-accounts/credential-schema.ts)**

Канонические схемы credentials per marketplace из §13:
- WB: required `apiToken`, `warehouseId`; optional `statToken`.
- Ozon: required `clientId`, `apiKey`, `warehouseId`.

Две функции:
- `validateCredentialsForCreate(marketplace, raw)` — проверяет required + отсекает unknown ключи + проверяет тип/длину каждого значения (max 1024 chars). Возвращает нормализованный `Record<string, string>`.
- `validateCredentialsForPartialUpdate(...)` — без required-проверок, для PATCH'a; финальная проверка required делается после merge с existing.

Granular error-коды: `CREDENTIALS_MISSING_FIELDS`, `CREDENTIALS_UNKNOWN_FIELDS`, `CREDENTIALS_FIELD_INVALID_TYPE`, `CREDENTIALS_FIELD_EMPTY`, `CREDENTIALS_FIELD_TOO_LONG`, `MARKETPLACE_NOT_SUPPORTED`, `CREDENTIALS_INVALID`. Это даёт UI возможность показывать локализованные сообщения.

`SECRET_FIELDS` map классифицирует, какие поля секретные (маскируются в preview), а какие — публичные metadata (`warehouseId` показывается целиком).

**3. Service [marketplace-accounts.service.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.service.ts)**

`create(tenantId, dto)`:
1. Валидация marketplace + label (trim, не пустая, ≤128).
2. `validateCredentialsForCreate` — все required поля per marketplace.
3. **Pre-check ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE** через `findFirst` — даёт человеческий 409 с `conflictAccountId` ещё до транзакции. DB-level partial UNIQUE остаётся как страховка от race.
4. **Pre-check ACCOUNT_LABEL_ALREADY_EXISTS** в `(tenant, marketplace, label)`.
5. `cipher.encrypt(credentials)` + `_buildMaskedPreview` (secret-поля → `***xxxx`, не-секретные — целиком).
6. Транзакция: `MarketplaceAccount.create` + `MarketplaceCredential.create` + `MarketplaceAccountEvent.create(eventType='marketplace_account_created')`. На P2002 (race с partial UNIQUE) — ловим и возвращаем тот же `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE`.
7. Account создаётся с `lifecycleStatus=ACTIVE`, `credentialStatus=VALIDATING`, `syncHealthStatus=UNKNOWN` — re-validate запустится в TASK_3.
8. Response: `_toReadModel` без encryptedPayload, только masked preview + metadata (keyVersion, schemaVersion, rotatedAt).

`update(tenantId, accountId, dto)`:
1. `UPDATE_EMPTY` если ни label, ни credentials не переданы.
2. Account lookup tenant-scoped → NotFound.
3. **Если label**: проверка trim/≤128, lookup на занятость (с `id: { not: accountId }`), → 409 при конфликте; запись `LABEL_UPDATED` event с `from/to`.
4. **Если credentials**: decrypt existing payload → merge с partial new fields → final `validateCredentialsForCreate` на merged (гарантирует, что после merge required всё ещё на месте) → encrypt → update `MarketplaceCredential.encryptedPayload + maskedPreview + rotatedAt=now` (или create если запись отсутствовала). Event `CREDENTIALS_ROTATED` с `payload: { keyVersion, fieldsRotated: [...] }` — НЕ значения, только список изменённых полей. `credentialStatus → VALIDATING`, `lastValidatedAt/ErrorCode/Message → null` для следующего валидационного цикла (TASK_3).
5. Response через `_toReadModel` — никаких полных значений секретов в payload.

`MarketplaceAccountEvents` константа — single source of truth для трёх типов событий этой задачи (`CREATED`, `LABEL_UPDATED`, `CREDENTIALS_ROTATED`).

**4. REST endpoints** [marketplace-accounts.controller.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.controller.ts)

```
POST   /marketplace-accounts        — create (TenantWriteGuard)
PATCH  /marketplace-accounts/:id    — update label / credentials (TenantWriteGuard)
```

Оба под `RequireActiveTenantGuard + TenantWriteGuard` — TRIAL_EXPIRED/SUSPENDED/CLOSED → 403. RBAC (Owner/Admin) и tenant-state-aware пути (label-only update в TRIAL_EXPIRED) — TASK_5.

[marketplace-accounts.module.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.module.ts) с экспортом `MarketplaceAccountsService` + `CredentialsCipher`. Зарегистрирован в [app.module.ts](apps/api/src/app.module.ts).

**5. Тесты — [marketplace-accounts.service.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.service.spec.ts)**

22 теста в 4 describe-блоках:

*create — happy paths (2):* WB-аккаунт с шифрованием + masked preview (`apiToken: '***7890'`, `warehouseId: '1001'`); полное значение `wb-token-1234567890` НЕ утекает в response (проверено `expect(json).not.toContain`); encryptedPayload пишется как Buffer; CREATED event эмитится. То же для Ozon — `apiKey: '***ghij'`, `clientId/warehouseId` не маскируются.

*create — конфликты и валидация (8):* `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` с `conflictAccountId`; `ACCOUNT_LABEL_ALREADY_EXISTS` (даже среди INACTIVE по UNIQUE label); `CREDENTIALS_MISSING_FIELDS` для WB без apiToken; `CREDENTIALS_UNKNOWN_FIELDS` для лишних ключей (anti-injection); `CREDENTIALS_FIELD_INVALID_TYPE` для не-строки; `CREDENTIALS_FIELD_TOO_LONG` для >1024 chars; `LABEL_REQUIRED`; `MARKETPLACE_NOT_SUPPORTED`; P2002 race → `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE`.

*update — partial credential update (7):* merge `apiToken` без потери `warehouseId`, новый masked preview, новое значение НЕ утекает в response, `CREDENTIALS_ROTATED` event с `fieldsRotated: ['apiToken']` (без значения); `credentialStatus → VALIDATING` + `lastValidationError* → null`; `LABEL_UPDATED` event с `from/to`; `ACCOUNT_LABEL_ALREADY_EXISTS` для занятого; `ACCOUNT_NOT_FOUND` для чужого; `UPDATE_EMPTY` для пустого DTO; `LABEL_REQUIRED` для whitespace.

*CredentialsCipher (4):* encrypt → decrypt roundtrip; ciphertext отличается для одинакового plaintext (IV randomization); повреждённый ciphertext бросает; `maskValue` для длинной/короткой/пустой/null.

Совокупно — `Tests: 22 passed, 22 total`. Глобально (inventory + warehouses + marketplace-accounts): `Tests: 208 passed, 208 total` в 11 suites. `tsc --noEmit` чисто.

### Соответствие критериям закрытия

- **Создание и обновление account не раскрывает секреты**: `_toReadModel` не возвращает `encryptedPayload`; `maskedPreview` маскирует все secret-поля по `SECRET_FIELDS` map per marketplace; полное новое значение в PATCH не возвращается (тест `expect(json).not.toContain('wb-token-9999')` явно). На уровне БД — секреты только в `encryptedPayload Bytes` (зашифрованы AES-256-GCM).
- **Response model безопасна и пригодна для UI**: identity + три статусных слоя (`lifecycleStatus`/`credentialStatus`/`syncHealthStatus`) + masked preview + `rotatedAt/encryptionKeyVersion/schemaVersion` для дебага. Никаких внутренних audit-меток (deactivatedBy raw FK без include) или encryptedPayload.
- **`ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` и `ACCOUNT_LABEL_ALREADY_EXISTS` отрабатывают предсказуемо**: pre-check даёт детерминированный 409 с `conflictAccountId` (для active-конфликта); DB-level partial UNIQUE через P2002-catch ловит race; то же для label uniqueness. Для каждого — отдельный тест.

### Что осталось вне scope

- Validation use-case per marketplace (тест credentials против реального API WB/Ozon с health-check) — TASK_3.
- GET endpoints `/marketplace-accounts` (list/by-id/diagnostics) — TASK_3 / 4.
- `deactivate` / `reactivate` endpoints + lifecycle transitions — TASK_4.
- Tenant-state guards для validate/reconnect (label-only update в TRIAL_EXPIRED) — TASK_5.
- RBAC enforcement Owner/Admin only — TASK_5 (HTTP-слой через RolesGuard).
- Frontend UX — TASK_6.
- Удаление legacy `apiKey/clientId/...` плэйнтекст-полей и переключение sync.service на encrypted credential storage — отдельная задача после TASK_3.
