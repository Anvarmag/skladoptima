# TASK_MARKETPLACE_ACCOUNTS_3 — Validate, Reconnect, Deactivate/Reactivate Lifecycle

> Модуль: `08-marketplace-accounts`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_1`
  - `TASK_MARKETPLACE_ACCOUNTS_2`
- Что нужно сделать:
  - реализовать `POST /api/v1/marketplace-accounts/:id/validate`;
  - реализовать `POST /api/v1/marketplace-accounts/:id/deactivate` и `POST /api/v1/marketplace-accounts/:id/reactivate`;
  - закрепить переходы `ACTIVE/INACTIVE` и `VALIDATING/VALID/INVALID/NEEDS_RECONNECT/UNKNOWN`;
  - при `reactivate` запускать повторную validate, а не считать account рабочим автоматически;
  - записывать lifecycle events и audit на create/update/validate/deactivate/reactivate.
- Критерий закрытия:
  - жизненный цикл account воспроизводим и не конфликтует с системной аналитикой;
  - reconnect flow не теряет историю и не ломает ссылки на sync/warehouses;
  - credential validity не смешивается с operational sync health.

**Что сделано**

### Контекст MVP до задачи

К моменту начала задачи в проекте:
- `MarketplaceAccountsService` (TASK_2) уже умел `create` и `update` со шифрованием credentials и masked preview;
- Schema `MarketplaceAccount` (TASK_1) имела все статусные поля + `MarketplaceAccountEvent` для audit-лога;
- Legacy [SyncService](apps/api/src/modules/marketplace_sync/sync.service.ts) дёргал `/api/v3/warehouses` (WB) и `/v1/warehouse/list` (Ozon) только как health check кнопкой `testWbConnection/testOzonConnection`, без записи credentialStatus и без формальной state-машины. Результат health-check возвращался прямо в HTTP response, без сохранения в БД.

Чего НЕ было:
- Сервиса валидации credentials, который бы переводил их в три состояния (`VALID`/`INVALID`/`NEEDS_RECONNECT`/`UNKNOWN`) на основе типа ошибки.
- Lifecycle endpoint'ов `/validate`, `/deactivate`, `/reactivate`.
- Audit events для validate/deactivate/reactivate flows.
- Гарантии «после reactivate credentials не считаются валидными автоматически — обязательная re-validate».

### Что добавлено

**1. [credential-validator.service.ts](apps/api/src/modules/marketplace-accounts/credential-validator.service.ts)**

`CredentialValidator` — DI-провайдер с двумя методами под marketplace:

- `_validateWb(c)` — `GET /api/v3/warehouses` с Authorization-header, timeout 8s.
- `_validateOzon(c)` — `POST /v1/warehouse/list` с `Client-Id + Api-Key`, timeout 8s.

Эти endpoint'ы выбраны как минимально-инвазивные read-only listings со стабильной авторизацией: 401/403 чётко указывают на проблему с credentials, не задевая business state.

**Маппинг axios-ошибок** в `CredentialValidationResult` через `_mapAxiosError`:

| HTTP / network | errorCode | needsReconnect | Куда переводит credentialStatus |
|---|---|---|---|
| 200 OK | (none) | — | `VALID` |
| 401 Unauthorized | `AUTH_UNAUTHORIZED` | false | `INVALID` |
| 403 Forbidden | `AUTH_FORBIDDEN` | **true** | `NEEDS_RECONNECT` |
| 4xx other | `HTTP_4xx` | false | `INVALID` |
| 5xx | `HTTP_5xx` | false | `UNKNOWN` |
| timeout | `NET_TIMEOUT` | — | `UNKNOWN` |
| network error | `NET_ERROR` | — | `UNKNOWN` |

Отдельные коды `CREDENTIAL_MISSING_API_TOKEN`/`CREDENTIAL_MISSING_OZON_KEYS` для случая, когда credentials расшифровались, но обязательных полей нет (data corruption / schema mismatch).

**2. `MarketplaceAccountsService.validate(tenantId, accountId)`**

Алгоритм:

1. Tenant-scoped lookup → 404 `ACCOUNT_NOT_FOUND` для чужого.
2. **Pre-check `ACCOUNT_INACTIVE`** — нельзя валидировать INACTIVE аккаунт (нужно reactivate сначала). Это закрепляет инвариант §14: validate доступен только в ACTIVE.
3. **Pre-check `ACCOUNT_HAS_NO_CREDENTIALS`** — если `credential` запись отсутствует, говорим явно (вместо мутного «invalid»).
4. **Прежде чем дёрнуть external API** — пишем `credentialStatus = VALIDATING` синхронно, чтобы UI/диагностика видели «идёт проверка», даже если процесс упадёт.
5. `cipher.decrypt(encryptedPayload)` → нормализуем в `Record<string, string>`.
6. Try-catch вокруг `validator.validate` — если сам валидатор упал (баг), переводим в `UNKNOWN` с `VALIDATOR_INTERNAL_ERROR`. Throw'ы наружу не пробрасываются.
7. **Маппинг ok → credentialStatus** (см. таблицу выше).
8. Транзакция: финальный `account.update` (только credential fields, БЕЗ syncHealth — §20 invariant) + `MarketplaceAccountEvent.create` с `marketplace_account_validated` или `_validation_failed`.
9. Structured-log с финальным `credentialStatus` и `errorCode`.

**Главный invariant §20**: validate меняет ТОЛЬКО `credentialStatus`/`lastValidatedAt`/`lastValidationError*`. Поля `syncHealthStatus`/`syncHealthReason`/`lastSyncResult` НЕ трогаются — отдельный тест явно проверяет `expect(...data).not.toHaveProperty('syncHealthStatus')`.

**3. `deactivate(tenantId, accountId, actorUserId)`**

- 404 для чужого, **409 `ACCOUNT_ALREADY_INACTIVE`** для уже неактивного.
- Транзакция: `lifecycleStatus = INACTIVE`, `deactivatedAt = now`, `deactivatedBy = actorUserId`, `syncHealthStatus = PAUSED`, `syncHealthReason = 'ACCOUNT_DEACTIVATED'` (PAUSED здесь логичен — никаких внешних вызовов на inactive account, см. §14 transition rules) + `MarketplaceAccountEvent` с `marketplace_account_deactivated`.
- **Не удаляет** связанные `Warehouse`/`StockBalance`/`MarketplaceOrder` records — historical reference links сохраняются (§10/§12 DoD).

**4. `reactivate(tenantId, accountId, actorUserId)`**

- 404 для чужого, **409 `ACCOUNT_ALREADY_ACTIVE`** для уже активного.
- **Pre-check `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE`**: ищем другой active в `(tenantId, marketplace)`. Если найден — 409 c `conflictAccountId`. Это application-level guard поверх DB partial UNIQUE.
- Транзакция: `lifecycleStatus = ACTIVE`, обнуляем `deactivatedAt/By`, **`credentialStatus = VALIDATING`** (КРИТИЧНО: НЕ возвращаем VALID автоматически), `lastValidationError* = null`, `syncHealthStatus = UNKNOWN`, `syncHealthReason = null` + `MarketplaceAccountEvent` с `marketplace_account_reactivated`.
- На P2002 (race с partial UNIQUE) — ловим и возвращаем тот же `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE`.
- **После reactivation сразу же вызываем `this.validate(...)`** — гарантия §10/§14: «при reactivate запускать повторную validate, а не считать account рабочим автоматически». Если validate API упадёт, credentialStatus останется в `UNKNOWN` с диагностикой; пользователь увидит «нужна повторная попытка».

**5. REST endpoints** ([marketplace-accounts.controller.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.controller.ts))

```
POST /marketplace-accounts/:id/validate      (TenantWriteGuard, HTTP 200)
POST /marketplace-accounts/:id/deactivate    (TenantWriteGuard, HTTP 200)
POST /marketplace-accounts/:id/reactivate    (TenantWriteGuard, HTTP 200)
```

Все три под `RequireActiveTenantGuard + TenantWriteGuard` — TRIAL_EXPIRED/SUSPENDED/CLOSED → 403. Tenant-state-aware ослабление (label-only / deactivate в TRIAL_EXPIRED) — TASK_5.

[marketplace-accounts.module.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.module.ts) дополнен `CredentialValidator` в providers/exports.

**6. Тесты — [marketplace-accounts.lifecycle.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.lifecycle.spec.ts)**

19 новых тестов в 4 describe-блоках:

*validate (10):*
- Успех → `VALID` + `VALIDATED` event + `lastValidationErrorCode = null`. Также проверяется, что **сначала** пишется `VALIDATING`, **потом** финальный статус (двойной update).
- `AUTH_UNAUTHORIZED` → `INVALID` + `VALIDATION_FAILED` event;
- `AUTH_FORBIDDEN + needsReconnect` → `NEEDS_RECONNECT`;
- `NET_TIMEOUT` → `UNKNOWN`;
- `HTTP_5xx` → `UNKNOWN` (server-side, не credentials);
- `HTTP_4xx (не 401/403)` → `INVALID`;
- `ACCOUNT_NOT_FOUND` для чужого;
- `ACCOUNT_INACTIVE` для INACTIVE;
- `ACCOUNT_HAS_NO_CREDENTIALS` если credential отсутствует;
- validator throws → `UNKNOWN` + `VALIDATOR_INTERNAL_ERROR`.

*deactivate (3):* успех с проверкой всех полей (`syncHealthStatus=PAUSED`, `deactivatedBy=ACTOR`, event payload), `ACCOUNT_ALREADY_INACTIVE`, `ACCOUNT_NOT_FOUND`.

*reactivate (5):* успех с **обязательным re-validate** (проверяем `validator.validate` was called И финальный credentialStatus после auto-validate); `ACCOUNT_ALREADY_ACTIVE`; `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` с `conflictAccountId`; P2002 race; `ACCOUNT_NOT_FOUND`.

*lifecycle invariant (1):* validate меняет ТОЛЬКО credential fields — `expect(updateData).not.toHaveProperty('syncHealthStatus')` явно проверяет §20 разделение слоёв.

Совокупно — `Tests: 41 passed, 41 total` для модуля (22 из TASK_2 + 19 новых). Глобально (inventory + warehouses + marketplace-accounts): `Tests: 227 passed, 227 total` в 12 suites. `tsc --noEmit` чисто.

### Соответствие критериям закрытия

- **Жизненный цикл account воспроизводим и не конфликтует с системной аналитикой**: все переходы из §14 покрыты — `create → ACTIVE/VALIDATING/UNKNOWN`, `successful validate → VALID`, `failed auth → INVALID|NEEDS_RECONNECT`, `manual deactivate → INACTIVE`, `reactivate → ACTIVE + auto validate`, `second active → forbidden`. Регрессионные тесты идут pass-by-pass по матрице §16.
- **Reconnect flow не теряет историю и не ломает ссылки на sync/warehouses**: `deactivate` НЕ удаляет связанные `Warehouse`/`StockBalance`/`MarketplaceOrder` (нет cascade-delete на эти таблицы); `reactivate` обнуляет только deactivation поля, не трогает historical records; events записываются в `MarketplaceAccountEvent` для полной audit chain.
- **Credential validity не смешивается с operational sync health**: validator физически не пишет в `syncHealthStatus`/`lastSyncResult`; lifecycle invariant test явно `expect(...).not.toHaveProperty('syncHealthStatus')`. Pause при deactivate (`syncHealthStatus=PAUSED`) — отдельный путь, не через credential validator.

### Что осталось вне scope

- GET endpoints (`/marketplace-accounts`, `/marketplace-accounts/:id`, `/marketplace-accounts/:id/diagnostics`) — TASK_4.
- Tenant-state-aware policy (label-only update + deactivate допустимы в TRIAL_EXPIRED, validate/reactivate — нет) — TASK_5.
- RBAC (Owner/Admin only) через RolesGuard — TASK_5.
- Frontend account UX с reconnect flow — TASK_6.
- Observability runbook + QA matrix — TASK_7.
- Удаление legacy `apiKey/clientId/...` плэйнтекст-полей и переключение `sync.service` на encrypted credential storage — отдельная задача после TASK_4.
