# Маркетплейс-аккаунты — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль управляет подключениями внешних каналов: credentials, валидация, статусы подключения, отключение/повторное подключение без потери исторических данных.

## 2. Функциональный контур и границы

### Что входит в модуль
- создание и хранение подключений к marketplace;
- валидация credentials и lifecycle подключения;
- маскирование секретов и безопасное обновление токенов;
- health-status account для sync/UI;
- базовый configuration layer для интеграций tenant.

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
| Sync module | Использует account config для обмена данными | Не меняет lifecycle без политики |
| Integration adapter | Проверяет credentials/health | Не должен раскрывать секреты наружу |
| Support/Admin | Диагностирует connection issues | Только через masked view и audit |

## 4. Базовые сценарии использования

### Сценарий 1. Подключение account
1. Пользователь выбирает marketplace и вводит credentials.
2. Backend валидирует формат payload.
3. Credentials шифруются и сохраняются.
4. Запускается validation/health check.
5. Account получает статус `connected` или `failed_validation`.

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

## 5. Зависимости и интеграции

- Sync module
- Secrets encryption service
- Audit module
- Notifications (errors / reconnect needed)

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
  "status": "CONNECTED",
  "lastValidatedAt": "2026-04-15T12:30:00Z"
}
```

## 8. Модель данных (PostgreSQL)

### `marketplace_accounts`
- `id UUID PK`, `tenant_id UUID`
- `marketplace ENUM(wb, ozon, yandex_market)`
- `label VARCHAR(128) NOT NULL`
- `status ENUM(connected, invalid_credentials, inactive, sync_error, needs_reconnect)`
- `is_active BOOLEAN DEFAULT true`
- `last_validated_at TIMESTAMPTZ NULL`
- `last_sync_at TIMESTAMPTZ NULL`
- `last_error_code VARCHAR(64) NULL`, `last_error_message TEXT NULL`
- `created_at`, `updated_at`

### `marketplace_credentials`
- `id UUID PK`, `account_id UUID FK`
- `encrypted_payload BYTEA NOT NULL`
- `encryption_key_version INT NOT NULL`
- `masked_preview JSONB`
- `updated_at`

### `marketplace_account_events`
- `id UUID PK`, `tenant_id UUID`, `account_id UUID`, `event_type`, `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Создание account: сохранить metadata, credentials зашифрованно.
2. Сразу после сохранения запустить `validate` against external API.
3. Если валидация ок -> `connected`; иначе -> `invalid_credentials`.
4. `deactivate` останавливает sync, но не удаляет исторические данные.
5. Любое обновление credentials пишет event/audit запись.

## 10. Валидации и ошибки

- Полные секреты не возвращаются в API после создания.
- Валидация обязательных полей зависит от marketplace.
- Ошибки:
  - `VALIDATION_ERROR: CREDENTIALS_INVALID`
  - `CONFLICT: ACCOUNT_LABEL_ALREADY_EXISTS`
  - `EXTERNAL_INTEGRATION_ERROR: VALIDATION_FAILED`

## 11. Чеклист реализации

- [ ] Таблицы account + encrypted credentials.
- [ ] Use-case validate per marketplace.
- [ ] Маскирование секретов в ответах API.
- [ ] Статусы lifecycle подключения.
- [ ] RBAC и аудит.

## 12. Критерии готовности (DoD)

- Несколько account одного marketplace поддерживаются.
- Credentials не утекaют в plaintext.
- Отключение не удаляет историю и связанный каталог/заказы.

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

- `CONNECTED`
- `INVALID_CREDENTIALS`
- `INACTIVE`
- `SYNC_ERROR`
- `NEEDS_RECONNECT`

### Разрешенные переходы
- create -> `CONNECTED | INVALID_CREDENTIALS`
- `CONNECTED -> SYNC_ERROR`
- `SYNC_ERROR -> CONNECTED`
- `CONNECTED -> INACTIVE`
- `INVALID_CREDENTIALS -> NEEDS_RECONNECT`
- `NEEDS_RECONNECT -> CONNECTED`

## 15. Async и события

- `marketplace_account_created`
- `marketplace_account_validated`
- `marketplace_account_validation_failed`
- `marketplace_account_deactivated`
- `marketplace_account_credentials_rotated`
- `marketplace_account_sync_error_detected`

### Что должно быть асинхронным
- initial validation
- re-validation
- уведомление о `needs_reconnect`

## 16. Тестовая матрица

- Создание валидного account.
- Создание account с неверными credentials.
- Обновление credentials.
- Деактивация account.
- Повторная активация account.
- Два account одного marketplace в одном tenant.

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
