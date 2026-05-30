# Маркетплейс-аккаунты — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `08-marketplace-accounts`

## 1. Назначение модуля

Модуль управляет подключениями внешних каналов: credentials, валидация, статусы подключения, отключение/повторное подключение без потери исторических данных.

### Текущее состояние (as-is)

- в backend уже есть модуль `marketplace/settings` с endpoint для marketplaces и store settings;
- во frontend есть страница `Settings`, которая закрывает часть сценариев настройки интеграций;
- но полноценный lifecycle account connect/validate/reconnect и encrypted credential storage пока только частично выражены в текущем коде.

### Целевое состояние (to-be)

- marketplace account должен стать самостоятельной сущностью с masked view, validation status и reconnect flow;
- секреты обязаны храниться только в шифрованном виде, а `credential validity` отделяться от `operational sync health`;
- effective runtime account должен учитывать не только credentials, но и `tenant AccessState`, чтобы при `TRIAL_EXPIRED / SUSPENDED / CLOSED` внешние API-вызовы не продолжали работать "мимо" продуктовой политики;
- аккаунт должен быть точкой опоры для sync, warehouse reference и financial imports.


## 2. Функциональный контур и границы

### Что входит в модуль
- создание и хранение подключений к marketplace;
- валидация credentials и lifecycle подключения;
- маскирование секретов и безопасное обновление токенов;
- health-status account для sync/UI;
- базовый configuration layer для интеграций tenant.
- диагностика effective runtime availability account.

### Что не входит в модуль
- сама синхронизация orders/stocks/catalog;
- финансовые отчеты маркетплейсов;
- биллинг интеграций и тарификация;
- общий secrets-vault инфраструктуры beyond module contract.

### Главный результат работы модуля
- tenant имеет формализованные интеграционные подключения с понятным статусом, безопасным хранением credentials и контролируемым жизненным циклом.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin | Создает, обновляет, деактивирует account | Основные управляющие роли |
| Manager | Просматривает статус и диагностику | Без изменения credentials и lifecycle |
| Sync module | Использует account config для обмена данными | Не меняет lifecycle без политики |
| Integration adapter | Проверяет credentials/health | Не должен раскрывать секреты наружу |
| Support/Admin | Диагностирует connection issues | Только через masked view и audit |

## 4. Базовые сценарии использования

### Сценарий 1. Подключение account
1. Пользователь выбирает marketplace и вводит credentials.
2. Backend валидирует формат payload.
3. Credentials шифруются и сохраняются.
4. Запускается validation/health check.
5. Account получает `credential_status = valid | invalid`, а runtime availability считается отдельно.

### Сценарий 2. Обновление credentials
1. Пользователь отправляет частичное или полное обновление secret-полей.
2. Backend обновляет только переданные значения.
3. Старые значения не возвращаются в API response.
4. Выполняется повторная валидация account.

### Сценарий 3. Деактивация account
1. Пользователь инициирует disable/disconnect.
2. Backend меняет lifecycle account.
3. Новые sync-run не планируются.
4. Исторические runs и связи сохраняются для диагностики.

### Сценарий 4. Tenant уходит в `TRIAL_EXPIRED`
1. Tenant переводится в `TRIAL_EXPIRED`.
2. Account не теряет credentials и историю подключений.
3. Внешние validation/sync операции ставятся на паузу.
4. UI показывает account как доступный для просмотра, но временно заблокированный для runtime-операций.

## 5. Зависимости и интеграции

- Sync module
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)
- Secrets encryption service
- Audit module
- Notifications (errors / reconnect needed)
- Warehouses

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/marketplace-accounts` | Owner/Admin | Создать подключение |
| `GET` | `/api/v1/marketplace-accounts` | User | Список подключений |
| `GET` | `/api/v1/marketplace-accounts/:id` | User | Карточка подключения |
| `PATCH` | `/api/v1/marketplace-accounts/:id` | Owner/Admin | Обновить label/credentials |
| `POST` | `/api/v1/marketplace-accounts/:id/validate` | Owner/Admin | Ручная валидация |
| `POST` | `/api/v1/marketplace-accounts/:id/deactivate` | Owner/Admin | Отключить подключение |
| `POST` | `/api/v1/marketplace-accounts/:id/reactivate` | Owner/Admin | Повторно активировать |
| `GET` | `/api/v1/marketplace-accounts/:id/diagnostics` | Owner/Admin/Manager | Диагностика validation/sync/runtime state |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/marketplace-accounts \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"marketplace":"OZON","label":"Ozon Основной","credentials":{"clientId":"...","apiKey":"...","warehouseId":"123"}}'
```

```json
{
  "id": "mpa_...",
  "marketplace": "OZON",
  "lifecycleStatus": "ACTIVE",
  "credentialStatus": "VALID",
  "syncHealthStatus": "HEALTHY",
  "lastValidatedAt": "2026-04-15T12:30:00Z"
}
```

### Frontend поведение

- Текущее состояние: маршрут `/app/settings` уже существует и закрывает часть интеграционных настроек.
- Целевое состояние: нужен отдельный UX подключений со статусом, диагностикой ошибок, reconnect и жизненным циклом account.
- UX-правило: пользователь должен видеть masked credential preview и причину сбоя без раскрытия чувствительных данных.
- UI должен различать три слоя состояния: `lifecycle`, `credential status`, `sync health`, а не сводить все к одному "красному индикатору".
- В MVP в рамках одного tenant допускается только один `active` account на каждый marketplace.
- При `TRIAL_EXPIRED` account остается видимым, но actions `validate`, `reconnect`, `sync now` блокируются как paused by tenant policy.
- При `TRIAL_EXPIRED` разрешены только внутренние действия без внешнего API: переименование `label` и `deactivate`.
- При `SUSPENDED` и `CLOSED` account виден только в диагностическом read-only режиме.

## 8. Модель данных (PostgreSQL)

### `marketplace_accounts`
- `id UUID PK`, `tenant_id UUID`
- `marketplace ENUM(wb, ozon, yandex_market)`
- `label VARCHAR(128) NOT NULL`
- `lifecycle_status ENUM(active, inactive) NOT NULL DEFAULT 'active'`
- `credential_status ENUM(validating, valid, invalid, needs_reconnect, unknown) NOT NULL DEFAULT 'validating'`
- `sync_health_status ENUM(healthy, degraded, paused, error, unknown) NOT NULL DEFAULT 'unknown'`
- `sync_health_reason VARCHAR(64) NULL`
- `last_validated_at TIMESTAMPTZ NULL`
- `last_validation_error_code VARCHAR(64) NULL`, `last_validation_error_message TEXT NULL`
- `last_sync_at TIMESTAMPTZ NULL`
- `last_sync_status ENUM(success, partial_success, failed) NULL`
- `last_sync_error_code VARCHAR(64) NULL`, `last_sync_error_message TEXT NULL`
- `deactivated_at TIMESTAMPTZ NULL`, `deactivated_by UUID NULL`
- `created_at`, `updated_at`
- `UNIQUE(tenant_id, marketplace, label)`
- `UNIQUE(tenant_id, marketplace) WHERE lifecycle_status = 'active'`

### `marketplace_credentials`
- `id UUID PK`, `account_id UUID FK`
- `encrypted_payload BYTEA NOT NULL`
- `encryption_key_version INT NOT NULL`
- `schema_version INT NOT NULL DEFAULT 1`
- `masked_preview JSONB`
- `updated_at`, `rotated_at TIMESTAMPTZ NULL`

### `marketplace_account_events`
- `id UUID PK`, `tenant_id UUID`, `account_id UUID`, `event_type`, `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Создание account: сохранить metadata, credentials зашифрованно, выставить `lifecycle_status=active`, `credential_status=validating`, `sync_health_status=unknown`.
2. Сразу после сохранения запустить `validate` against external API.
3. Если валидация ок -> `credential_status=valid`, иначе -> `credential_status=invalid`.
4. Завершение sync-run обновляет только `sync_health_status` и `last_sync_*`, не меняя credential validity без явного auth-сигнала от adapter.
5. `deactivate` переводит account в `inactive`, останавливает новые sync-run и validation jobs, но не удаляет исторические данные.
6. При `tenant AccessState in (TRIAL_EXPIRED, SUSPENDED, CLOSED)` effective runtime account считается paused, даже если credentials валидны.
7. В MVP создание второго `active` account того же marketplace в том же tenant запрещено до деактивации текущего.
8. Любое обновление credentials пишет event/audit запись.

## 10. Валидации и ошибки

- Полные секреты не возвращаются в API после создания.
- Валидация обязательных полей зависит от marketplace.
- Создание второго `active` account того же marketplace в том же tenant запрещено.
- `validate/reactivate` запрещены при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
- При `TRIAL_EXPIRED` разрешены только внутренние действия без внешнего API: `PATCH label`, `deactivate`.
- `deactivate` не должен удалять `warehouses`, `sync_runs`, `orders`, `inventory` reference links.
- Ошибки:
  - `VALIDATION_ERROR: CREDENTIALS_INVALID`
  - `CONFLICT: ACCOUNT_LABEL_ALREADY_EXISTS`
  - `CONFLICT: ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE`
  - `FORBIDDEN: ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE`
  - `CONFLICT: ACCOUNT_ALREADY_INACTIVE`
  - `EXTERNAL_INTEGRATION_ERROR: VALIDATION_FAILED`

## 11. Чеклист реализации

- [x] Таблицы account + encrypted credentials. *(TASK_MARKETPLACE_ACCOUNTS_1, 2026-04-26 — расширение MarketplaceAccount 13 полями §8 + новые модели MarketplaceCredential (1:1, encryptedPayload Bytes + maskedPreview Json + key/schemaVersion + rotatedAt) и MarketplaceAccountEvent (append-only журнал); 4 новых enum (Lifecycle/Credential/SyncHealth/LastSync статусы); UNIQUE(tenantId, marketplace, label) + partial UNIQUE WHERE lifecycleStatus='ACTIVE' через raw SQL — DB-level enforce single active account; backfill label=name для legacy записей)*
- [x] Use-case validate per marketplace. *(TASK_MARKETPLACE_ACCOUNTS_3, 2026-04-26 — `CredentialValidator` с per-marketplace endpoints WB `/api/v3/warehouses` + Ozon `/v1/warehouse/list` (8s timeout), маппинг 401/403/4xx/5xx/timeout в credentialStatus VALID/INVALID/NEEDS_RECONNECT/UNKNOWN; `MarketplaceAccountsService.validate/deactivate/reactivate` с lifecycle транзишнами §14, защитой §20 «credential validity ≠ sync health», обязательным re-validate после reactivate; lifecycle events VALIDATED/VALIDATION_FAILED/DEACTIVATED/REACTIVATED в MarketplaceAccountEvent журнал; 19 новых unit-тестов)*
- [x] Маскирование секретов в ответах API. *(TASK_MARKETPLACE_ACCOUNTS_2, 2026-04-26 — `CredentialsCipher` AES-256-GCM с key/schema versioning, `_buildMaskedPreview` через `SECRET_FIELDS` map per marketplace; полные значения секретов никогда не возвращаются в API response)*
- [x] Разделение `lifecycle_status`, `credential_status`, `sync_health_status`. *(TASK_MARKETPLACE_ACCOUNTS_1, 2026-04-26 — три независимых enum + 3 индекса для UI/диагностики)*
- [ ] RBAC и аудит. *(audit покрыт в TASK_3/4 через MarketplaceAccountEvent журнал; tenant-state-aware policy + PAUSED_BY_TENANT_STATE events добавлены TASK_5; RBAC через RolesGuard — отдельный refactoring)*
- [x] Dual-token WB: `analyticsToken` вместо `statToken`, маршрутизация по scope в sync.service. *(TASK_ANALYTICS_8, 2026-05-03 — `getWbHeaders(settings, 'analytics')` использует `analyticsToken ?? apiToken`; `pullWbFinances()` явно требует `analyticsToken` для statistics-api и возвращает `ANALYTICS_TOKEN_MISSING` если токен не задан)*
- [x] Миграция sync-слоя на encrypted credential storage. *(2026-05-03 — `SyncService.getSettings()` и `WarehouseSyncService` переведены на чтение credentials из `MarketplaceCredential.encryptedPayload` через `CredentialsCipher`; для WB: `dec.apiToken` → `wbApiKey`, `dec.warehouseId` → `wbWarehouseId`, `dec.analyticsToken` → `wbAnalyticsKey`; для Ozon: `dec.clientId/apiKey/warehouseId`; fallback на legacy plaintext поля — обратная совместимость со старыми аккаунтами из Settings; `WarehousesModule` импортирует `MarketplaceAccountsModule` для `CredentialsCipher`; `getSettings()` теперь фильтрует только `lifecycleStatus=ACTIVE` и выполняет WB/Ozon запросы параллельно через `Promise.all`)*

## 12. Критерии готовности (DoD)

- Credentials не утекaют в plaintext.
- Отключение не удаляет историю и связанные `warehouses/sync/orders/inventory` ссылки.
- UI и API одинаково интерпретируют `lifecycle`, `credential validity` и `sync health`.
- В рамках tenant не возникает неоднозначности, какой marketplace account является operational source.

## 13. Поля credentials по маркетплейсам

### Wildberries
- `apiToken` — **обязательный**; права «Маркетплейс (чтение и запись)»; используется только для `marketplace-api.wildberries.ru`
- `analyticsToken` — **опциональный**; права «Статистика + Контент (только чтение)»; используется для `statistics-api` и `content-api`; если не задан — fallback на `apiToken`
- `warehouseId`
- `statToken` — **deprecated**, alias для `analyticsToken`; legacy-accounts с этим полем продолжают работать через fallback-цепочку в `getWbHeaders()`; новые accounts должны использовать `analyticsToken`

### Ozon
- `clientId`
- `apiKey`
- `warehouseId`

### Яндекс.Маркет
- `campaignId`
- `token`
- дополнительные account/store identifiers при необходимости

## 14. State machine подключения

### `lifecycle_status`
- `ACTIVE`
- `INACTIVE`

### `credential_status`
- `VALIDATING`
- `VALID`
- `INVALID`
- `NEEDS_RECONNECT`
- `UNKNOWN`

### `sync_health_status`
- `HEALTHY`
- `DEGRADED`
- `PAUSED`
- `ERROR`
- `UNKNOWN`

### Правила переходов
- create -> `lifecycle=ACTIVE`, `credential=VALIDATING`, `sync_health=UNKNOWN`
- successful validate -> `credential=VALID`
- failed auth validate -> `credential=INVALID` или `NEEDS_RECONNECT`
- successful sync -> `sync_health=HEALTHY`
- partial/temporary sync failures -> `sync_health=DEGRADED | ERROR`
- tenant enters `TRIAL_EXPIRED / SUSPENDED / CLOSED` -> effective runtime `PAUSED`
- manual deactivate -> `lifecycle=INACTIVE`
- reactivate -> `lifecycle=ACTIVE`, затем повторная validate
- create second active account for same marketplace -> forbidden in MVP

## 15. Async и события

- `marketplace_account_created`
- `marketplace_account_validated`
- `marketplace_account_validation_failed`
- `marketplace_account_deactivated`
- `marketplace_account_reactivated`
- `marketplace_account_credentials_rotated`
- `marketplace_account_sync_error_detected`
- `marketplace_account_paused_by_tenant_state`

### Что должно быть асинхронным
- initial validation
- re-validation
- уведомление о `needs_reconnect`
- пересчет runtime health после tenant-state changes

## 16. Тестовая матрица

- Создание валидного account.
- Создание account с неверными credentials.
- Попытка создать второй `active` account того же marketplace.
- Обновление credentials.
- Деактивация account.
- Повторная активация account.
- Sync error меняет `sync_health_status`, но не ломает `credential_status`.
- `TRIAL_EXPIRED` ставит runtime account на паузу без удаления подключения.
- В `TRIAL_EXPIRED` разрешены `label update/deactivate`, но запрещены `validate/reactivate/sync now`.
- `SUSPENDED/CLOSED` блокируют validate/reconnect actions.

## 17. Фазы внедрения

1. Account core и encrypted credentials storage.
2. Validation adapters per marketplace.
3. Lifecycle status management.
4. UI/API диагностика + reconnect flow.

## 18. Нефункциональные требования и SLA

- Создание/валидация account должны быть безопасными по секретам и не логировать чувствительные поля.
- Health-check и reconnect flows выполняются асинхронно, а UI получает диагностируемый статус.
- Чтение списка account и masked details: `p95 < 300 мс`.
- Любой disconnect/connect статус должен быть устойчив к повторным validation jobs и race conditions.
- Любой tenant-state change должен детерминированно отражаться на runtime availability account без ручной пересборки состояний в UI.

## 19. Observability, логи и алерты

- Метрики: `accounts_created`, `accounts_connected`, `validation_failed`, `credentials_rotated`, `account_disabled`, `health_degraded`.
- Логи: validation attempts, adapter-specific error taxonomy, lifecycle transitions.
- Алерты: массовые validation failures по конкретному marketplace, повторяющиеся auth errors, stuck in validating state.
- Dashboards: connection funnel, health by marketplace, reconnect backlog board.

## 20. Риски реализации и архитектурные замечания

- Если хранение credentials не будет стандартизировано сразу, позже модуль станет непредсказуемым и небезопасным.
- Нужно разделить `валидность credentials` и `операционное здоровье sync`, иначе пользователю будет непонятно, что именно сломано.
- Секреты должны проходить только через шифрованный storage и masked responses.
- Конфигурация account должна быть расширяема под разные marketplace без дублирования доменной модели на каждый новый адаптер.
- В future scope multiple accounts одного marketplace потребуют отдельной политики маршрутизации для sync, warehouses и inventory; в MVP это сознательно запрещено.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю marketplace accounts больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Разделены lifecycle/credential/sync statuses, добавлены tenant-state guards и открытые решения по multi-account policy | Codex |
| 2026-04-18 | Подтверждено правило одного active account на marketplace и internal-only actions в `TRIAL_EXPIRED` | Codex |
| 2026-05-03 | §11 закрыт: sync-слой переведён на encrypted credential storage — `SyncService.getSettings()` и `WarehouseSyncService._resolveCredentials()` читают из `MarketplaceCredential.encryptedPayload`; fallback на legacy plaintext для обратной совместимости | Claude |
| 2026-05-03 | §13 обновлён: `statToken` помечен deprecated, добавлен `analyticsToken`; §11 добавлен чеклист TASK_8 (dual-token WB, FR-30); подробная аналитика в `TASK_MARKETPLACE_ACCOUNTS_8_ANALYTICS.md` | Claude |
| 2026-05-03 | TASK_ANALYTICS_8 выполнен: §11 dual-token чеклист закрыт. Добавлена модель `WbFinanceReport` (Prisma + миграция `20260503000000_wb_finance_report`); `pullWbFinances(tenantId, days)` в `sync.service.ts` — тянет `/api/v5/supplier/reportDetailByPeriod` с analyticsToken, пагинация через rrdid, upsert по `UNIQUE(tenantId, realizationId)`; `POST /sync/pull/wb-finances` endpoint; `_loadInputs` в `finance-snapshot.service.ts` обновлён: WbFinanceReport даёт per-SKU `marketplaceFees+logistics`, MarketplaceReport остаётся fallback; `PULL_FINANCES_WB` добавлен в `SyncTypes` и в модал ручного запуска на frontend; без `analyticsToken` → `ANALYTICS_TOKEN_MISSING` | Claude |
| 2026-04-26 | TASK_MARKETPLACE_ACCOUNTS_7 выполнен: каноничные имена events вынесены в `marketplace-account.events.ts` (9 констант через `as const` объект `MarketplaceAccountEventNames`), сервисный `MarketplaceAccountEvents` теперь re-export для обратной совместимости; регрессионный пакет `marketplace-accounts.regression.spec.ts` явно покрывает все строки тест-матрицы §16 (создание валидных WB/Ozon, невалидные credentials, single-active rule pre-check + P2002 race + reactivate, partial credentials update, deactivate с сохранением sync history, reactivate с обязательной re-validate, sync error не ломает credential validity §20, TRIAL_EXPIRED policy с разрешённым label/deactivate vs заблокированным validate/reactivate/credentials/create, SUSPENDED/CLOSED полный read-only, Yandex Market out of MVP); SECURITY блок (5 тестов): full token не утекает в CREATE/UPDATE/DIAGNOSTICS response, encryptedPayload невидим, structured-logs не содержат секретов (агрегированная проверка `Logger.log/warn` mock calls), CREDENTIALS_ROTATED payload содержит только fieldsRotated имена, SYNC_ERROR_DETECTED payload без credentials; OBSERVABILITY блок: все 9 event-имён existence-check + PAUSED_BY_TENANT_STATE event с action+accessState payload; runbook `MARKETPLACE_ACCOUNTS_OBSERVABILITY.md` с соответствием §19 метрик источникам, 6 алертов P0/P1/P2 (mass validation failures, reconnect backlog, stuck VALIDATING, sync error spike, paused-by-tenant rate, single-active race), диагностическими curl + SQL запросами, 5 рекомендованных дашбордов, 6 явных security-инвариантов; 27 новых тестов; total marketplace-accounts: **119 passed in 5 suites**, глобально **305 passed in 15 suites** (inventory + warehouses + marketplace-accounts) | Claude |
| 2026-04-26 | TASK_MARKETPLACE_ACCOUNTS_6 выполнен: новая web-страница `apps/web/src/pages/MarketplaceAccounts.tsx` с master-detail UX — список аккаунтов с 4 цветными бейджами на строку (marketplace + lifecycle + credential + sync), quick-add buttons для WB/Ozon с disabled+tooltip при active conflict (single-active rule превентивно в UI) или externalBlocked, action buttons (Проверить/Изменить/Отключить/Включить) с per-action блокировкой через `WRITE_BLOCKED_STATES` (SUSPENDED/CLOSED) и `EXTERNAL_API_BLOCKED_STATES` (TRIAL_EXPIRED/SUSPENDED/CLOSED) — точно отражает service-level policy TASK_5; diagnostics panel: большой `effectiveRuntimeState` бейдж + `EFFECTIVE_HINT` параграф (5 человекочитаемых объяснений) + 3 status-cards (lifecycle/credential/sync) с error-полями + tenant access state amber-карточка для PAUSED_BY_TENANT + recent events (50) с `summarizePayload` форматированием БЕЗ значений секретов; create/edit modal — динамические поля под marketplace (WB: apiToken+warehouseId+statToken, Ozon: clientId+apiKey+warehouseId), masked preview existing credentials в edit-режиме (`apiToken: ***7890`), partial credential update через `formSecretsTouched` map — в PATCH попадают только тронутые поля, Eye/EyeOff toggle для секретов с `autoComplete="new-password"`; универсальный `mapServerError` маппинг 13 backend-кодов в локализованные сообщения; регистрация `/app/integrations` роута + NavLink «Подключения» (Plug icon); legacy Settings.tsx сохранён без изменений до отдельной задачи переключения sync.service; tsc/vite build чистые | Claude |
| 2026-04-26 | TASK_MARKETPLACE_ACCOUNTS_5 выполнен: tenant-state-aware policy в `MarketplaceAccountsService` (defense-in-depth поверх HTTP `TenantWriteGuard`); три helper'а `_getTenantAccessState`, `_assertExternalApiAllowed` (блок для TRIAL_EXPIRED/SUSPENDED/CLOSED + PAUSED_BY_TENANT_STATE event в audit chain), `_assertInternalWriteAllowed` (только READ_ONLY_TENANT_STATES блокирует — TRIAL_EXPIRED оставляет label/deactivate); per-action policy: create/validate/reactivate/update_credentials → external (полный блок), update_label/deactivate → internal (TRIAL_EXPIRED разрешён), reportSyncRun → inline pause check возвращает `{paused: true}` без записи health; `MarketplaceAccountEvents.PAUSED_BY_TENANT_STATE` (зарезервирован в TASK_4) теперь активно пишется при каждой блокировке с `{action, accessState}` payload; `TenantWriteGuard` снят с PATCH/deactivate на контроллере (service-level granular policy); single-active rule — application pre-check `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` с `conflictAccountId` + DB partial UNIQUE P2002 catch в create и reactivate; **TENANT_NOT_FOUND** для фантомных tenant; 31 новый unit-тест (TRIAL_EXPIRED-блок 4, TRIAL_EXPIRED-allow 2, SUSPENDED/CLOSED-block 7, reportSyncRun pause 4, single-active 4, TENANT_NOT_FOUND 2 + edge-кейсы); регрессия 61 предыдущего теста — добавлен `tenant.findUnique` mock в makePrismaMock для service.spec.ts и lifecycle.spec.ts; total: **92 passed in 4 marketplace-accounts suites**, глобально **278 passed in 14 suites** | Claude |
| 2026-04-26 | TASK_MARKETPLACE_ACCOUNTS_4 выполнен: read API `GET /marketplace-accounts` (list с фильтрами marketplace/lifecycleStatus/credentialStatus, sort `(lifecycle, marketplace, label)`), `GET /:id` (карточка), **`GET /:id/diagnostics`** с расширенным response — `tenantAccessState`, `effectiveRuntimeState` (`OPERATIONAL`/`PAUSED_BY_TENANT`/`CREDENTIAL_BLOCKED`/`SYNC_DEGRADED`/`INACTIVE` через приоритетный `_computeEffectiveRuntime` с tenant→lifecycle→credential→sync порядком), `statusLayers` с тремя независимыми разделами и error-полями, `recentEvents[50]` из `MarketplaceAccountEvent` журнала; `reportSyncRun(tenantId, accountId, result)` — публичный API для sync.service/worker, обновляет ТОЛЬКО sync-health поля (lastSyncAt/Result/Error*, syncHealthStatus/Reason), на ok=false эмитит `marketplace_account_sync_error_detected` event с `{errorCode, partial}` payload, **§20 invariant `reportSyncRun` не трогает credential fields** покрыт явным тестом; `MarketplaceAccountEvents` константа расширена до 9 типов (CREATED/LABEL_UPDATED/CREDENTIALS_ROTATED/VALIDATED/VALIDATION_FAILED/DEACTIVATED/REACTIVATED/SYNC_ERROR_DETECTED/PAUSED_BY_TENANT_STATE); read endpoints под `RequireActiveTenantGuard` без `TenantWriteGuard` (справочник остаётся read-only видим в paused state); 20 unit-тестов; total inventory+warehouses+marketplace-accounts: **247 passed in 13 suites** | Claude |
| 2026-04-26 | TASK_MARKETPLACE_ACCOUNTS_3 выполнен: `CredentialValidator` сервис с per-marketplace HTTP health-check (WB `/api/v3/warehouses`, Ozon `/v1/warehouse/list`, 8s timeout), маппинг axios-ошибок в `CredentialValidationResult` — 401→AUTH_UNAUTHORIZED→INVALID, 403→AUTH_FORBIDDEN→NEEDS_RECONNECT (needsReconnect=true), 4xx прочие→INVALID, 5xx/timeout/network→UNKNOWN; `MarketplaceAccountsService.validate` (decrypt → write VALIDATING до вызова → call validator → mapping → транзакция: account.update только credential fields БЕЗ syncHealth + VALIDATED/VALIDATION_FAILED event; защита от throw'ов validator → VALIDATOR_INTERNAL_ERROR + UNKNOWN; pre-checks ACCOUNT_INACTIVE и ACCOUNT_HAS_NO_CREDENTIALS); `deactivate` (lifecycleStatus→INACTIVE, deactivatedAt/By, syncHealthStatus→PAUSED+ACCOUNT_DEACTIVATED reason, DEACTIVATED event; не удаляет historical records — sync/orders/warehouses сохраняются; ACCOUNT_ALREADY_INACTIVE 409); `reactivate` (pre-check ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE с conflictAccountId, P2002 catch, обнуление deactivation полей, **credentialStatus→VALIDATING принудительно** — НЕ возвращаем VALID автоматически, REACTIVATED event, **сразу же вызывает validate()** для гарантии §10/§14 «не считаем рабочим автоматически»); 4 новых события в MarketplaceAccountEvents константе; 3 REST endpoints `POST /:id/validate|deactivate|reactivate` под TenantWriteGuard; **главный invariant §20 «credential validity ≠ sync health»** покрыт явным тестом `expect(...).not.toHaveProperty('syncHealthStatus')`; 19 новых unit-тестов; total inventory+warehouses+marketplace-accounts: **227 passed in 12 suites** | Claude |
| 2026-04-26 | TASK_MARKETPLACE_ACCOUNTS_2 выполнен: новый модуль `apps/api/src/modules/marketplace-accounts/` с `CredentialsCipher` (AES-256-GCM, IV+tag+ct формат, ENV `MARKETPLACE_CREDENTIALS_KEY` 32 bytes, `MARKETPLACE_CREDENTIALS_KEY_VERSION` для rotation, dev fallback на детерминированный sha256 sentinel, `maskValue` `***xxxx` для UI); credential schema validation per marketplace (WB: apiToken+warehouseId required, statToken optional; Ozon: clientId+apiKey+warehouseId required) с гранулярными error-кодами `CREDENTIALS_MISSING_FIELDS/UNKNOWN_FIELDS/FIELD_INVALID_TYPE/FIELD_EMPTY/FIELD_TOO_LONG`; `MarketplaceAccountsService.create` (pre-check ACTIVE_ACCOUNT_ALREADY_EXISTS + ACCOUNT_LABEL_ALREADY_EXISTS, encrypt + masked preview, транзакция account+credential+CREATED event, P2002 race → ACTIVE_ACCOUNT_ALREADY_EXISTS) и `update` (partial credential merge через decrypt existing + new fields → final required check → encrypt + rotatedAt + CREDENTIALS_ROTATED event с fieldsRotated списком БЕЗ значений; LABEL_UPDATED event с from/to; credentialStatus→VALIDATING, lastValidationError*→null); REST endpoints `POST/PATCH /marketplace-accounts` под RequireActiveTenantGuard+TenantWriteGuard; полные значения секретов никогда не возвращаются в response (тестировано `expect(json).not.toContain`); 22 unit-теста; total inventory+warehouses+marketplace-accounts: **208 passed in 11 suites** | Claude |
| 2026-04-26 | TASK_MARKETPLACE_ACCOUNTS_1 выполнен: 4 новых enum (`MarketplaceLifecycleStatus`, `MarketplaceCredentialStatus`, `MarketplaceSyncHealthStatus`, `MarketplaceLastSyncStatus`); расширение `MarketplaceAccount` 13 полями §8 (label NOT NULL с backfill из name, lifecycle/credential/syncHealth статусы, syncHealthReason, lastValidatedAt + lastValidationError*, lastSyncResult enum + lastSyncError*, deactivatedAt/By с FK User SetNull); новая модель `MarketplaceCredential` 1:1 с UNIQUE(accountId), encryptedPayload Bytes, encryptionKeyVersion, schemaVersion, maskedPreview JSONB, rotatedAt; `MarketplaceAccountEvent` append-only журнал с 2 индексами; UNIQUE(tenantId, marketplace, label) + **partial UNIQUE INDEX WHERE lifecycleStatus='ACTIVE'** через raw SQL — DB-level enforce единственного active account per marketplace; legacy plaintext поля (apiKey/clientId/statApiKey/warehouseId/lastSyncStatus String?) НЕ удалены — миграция в encrypted storage в TASK_2/3; `MarketplaceType` enum НЕ расширяется YANDEX_MARKET (breaking change для Product/Order/Report); `settings.service.ts` минимально подправлен (label='Wildberries'/'Ozon' в legacy create); регрессия inventory + warehouses 186/186 passed | Claude |
