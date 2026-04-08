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

- [ ] Таблицы account + encrypted credentials.
- [ ] Use-case validate per marketplace.
- [ ] Маскирование секретов в ответах API.
- [ ] Разделение `lifecycle_status`, `credential_status`, `sync_health_status`.
- [ ] RBAC и аудит.

## 12. Критерии готовности (DoD)

- Credentials не утекaют в plaintext.
- Отключение не удаляет историю и связанные `warehouses/sync/orders/inventory` ссылки.
- UI и API одинаково интерпретируют `lifecycle`, `credential validity` и `sync health`.
- В рамках tenant не возникает неоднозначности, какой marketplace account является operational source.

## 13. Поля credentials по маркетплейсам

### Wildberries
- `apiToken`
- `statToken` (если нужен отдельный контур статистики)
- `warehouseId` / `warehouseExternalId`

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
