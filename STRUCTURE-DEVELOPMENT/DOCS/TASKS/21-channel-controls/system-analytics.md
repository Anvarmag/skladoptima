# Channel Controls — Системная аналитика

> Статус: [ ] На review
> Последнее обновление: 2026-04-29
> Связанный раздел: `21-channel-controls`

## 1. Назначение модуля

Модуль реализует три взаимосвязанные фичи управления каналами продаж:
1. **StockChannelLock** — блокировка отправки остатков на конкретный маркетплейс для конкретного товара.
2. **Channel Visibility Settings** — настройки видимости колонок маркетплейсов в UI остатков.
3. **Product Channel Mapping UI** — удобный интерфейс для склейки артикулов с разных площадок в один внутренний товар.

### Текущее состояние (as-is)

- механизм блокировок синхронизации в проекте отсутствует: push_stocks всегда отправляет актуальный баланс, игнорируя любые ручные правки;
- настройки видимости каналов в UI нет — все подключённые маркетплейсы всегда отображаются;
- `ProductChannelMapping` как доменная модель существует и реализована в `mapping.service.ts`, однако UI для явной склейки и управления маппингом неполный — пользователю неочевидно, как связать артикулы.

### Целевое состояние (to-be)

- sync pipeline обязан перед каждым push_stocks-item проверять `StockChannelLock`; если блокировка найдена, отправляется зафиксированное значение (0 / fixed / skip), а не реальный баланс;
- пользователь управляет видимостью каналов в UI остатков через настройки тенанта без влияния на данные и синхронизацию;
- в разделе каталога и остатков есть явный блок «Связанные артикулы» с возможностью добавить/удалить маппинг вручную.

## 2. Функциональный контур и границы

### Что входит в модуль

- модель `StockChannelLock` с поддержкой типов ZERO / FIXED / PAUSED;
- API CRUD для блокировок (create, get, delete, list);
- хук в pipeline push_stocks, проверяющий блокировки перед отправкой;
- модель `ChannelVisibilitySettings` (JSON-поле в tenant settings или отдельная таблица);
- API для чтения и обновления настроек видимости;
- улучшенный API маппинга: bulk-get mappings by productId, detach mapping;
- audit события для блокировок и маппинга;
- frontend: панель блокировок в таблице остатков, настройка видимости каналов, UI склейки в карточке товара.

### Что не входит в модуль

- изменение алгоритма pull_stocks и логики получения данных с маркетплейса;
- авто-блокировки на основе правил или триггеров;
- маппинг на уровне вариантов/размеров/цветов внутри одного артикула;
- физический WMS-контур.

### Главный результат работы модуля

- пользователь имеет контроль над тем, что именно уходит на каждый маркетплейс, и может заморозить значение остатка, не опасаясь что система его перезапишет.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin | Создаёт и снимает блокировки, управляет настройками видимости, делает склейку | Полный доступ |
| Manager | Смотрит блокировки, управляет видимостью | Не может создавать/снимать блокировки (опционально по RBAC) |
| Sync pipeline (push_stocks) | Читает блокировки перед отправкой | Read-only, не изменяет блокировки |
| Audit | Получает события блокировок и маппинга | Append-only |

## 4. Базовые сценарии использования

### Сценарий 1. Установка ZERO-блокировки для распродажи FBO
1. Пользователь выбирает товар в таблице остатков.
2. Нажимает «Заблокировать синхронизацию» → выбирает маркетплейс ВБ → тип ZERO.
3. Backend создаёт `StockChannelLock(productId, WB, ZERO)`.
4. Следующий push_stocks для этого товара на ВБ отправляет 0, независимо от реального баланса.
5. Товар помечен в UI как заблокированный (badge/иконка).
6. Пользователь продал FBO, снимает блокировку → следующий sync отправляет актуальный баланс.

### Сценарий 2. Скрытие канала в таблице остатков
1. Пользователь идёт в настройки → «Видимость каналов».
2. Снимает галочку с Ozon.
3. Backend сохраняет `ChannelVisibilitySettings` тенанта.
4. Таблица остатков перезагружается без колонок Ozon.
5. Данные и синхронизация Ozon не затронуты.

### Сценарий 3. Ручная склейка артикулов
1. Пользователь открывает карточку товара.
2. В блоке «Связанные артикулы» видит, что ВБ-маппинг есть, а Ozon — нет.
3. Нажимает «Добавить маппинг» → вводит externalProductId Ozon.
4. Backend вызывает `MappingService.manualMapping`.
5. Товар теперь отображается с обоими артикулами, суммарный остаток агрегируется.

### Сценарий 4. Конфликт при склейке
1. Пользователь пытается привязать Ozon-артикул, который уже привязан к другому товару.
2. Backend возвращает `CONFLICT: MAPPING_ALREADY_EXISTS`.
3. UI показывает сообщение с указанием, к какому товару уже привязан артикул.

## 5. Зависимости и интеграции

- `06-inventory` — StockChannelLock живёт поверх stock balances; pull-данные продолжают приходить
- `09-sync` — push_stocks pipeline читает StockChannelLock перед отправкой каждого item
- `05-catalog` — ProductChannelMapping — существующая модель склейки
- `08-marketplace-accounts` — блокировки валидируются по активным аккаунтам
- `16-audit` — создание/снятие блокировок и операции с маппингом логируются

## 6. API-контракт (внедрить)

### Stock Channel Locks

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/stock-locks` | Owner/Admin/Manager | Список всех блокировок тенанта |
| `GET` | `/api/v1/stock-locks?productId=&marketplace=` | Owner/Admin/Manager | Фильтрация по товару/каналу |
| `POST` | `/api/v1/stock-locks` | Owner/Admin | Создать блокировку |
| `DELETE` | `/api/v1/stock-locks/:lockId` | Owner/Admin | Снять блокировку |
| `DELETE` | `/api/v1/stock-locks?productId=&marketplace=` | Owner/Admin | Снять блокировку по ключу |

### Channel Visibility Settings

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/channel-visibility` | User | Получить настройки видимости |
| `PATCH` | `/api/v1/channel-visibility` | Owner/Admin | Обновить видимость каналов |

### Product Channel Mapping (существующий, расширить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/catalog/products/:productId/mappings` | User | Все маппинги товара |
| `POST` | `/api/v1/catalog/mappings` | Owner/Admin | Создать маппинг вручную |
| `DELETE` | `/api/v1/catalog/mappings/:mappingId` | Owner/Admin | Удалить маппинг |

## 7. Примеры вызова API

```bash
# Создать ZERO-блокировку
curl -X POST /api/v1/stock-locks \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"productId":"prd_...","marketplace":"WB","lockType":"ZERO","note":"Распродажа FBO"}'

# Ответ
{
  "id": "lock_...",
  "productId": "prd_...",
  "marketplace": "WB",
  "lockType": "ZERO",
  "fixedValue": null,
  "note": "Распродажа FBO",
  "createdAt": "2026-04-29T..."
}

# Обновить видимость каналов
curl -X PATCH /api/v1/channel-visibility \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"visibleMarketplaces":["WB"]}'
```

### Frontend поведение

- **Таблица остатков**: над таблицей — кнопка «Каналы» с dropdown выбора видимых колонок. Заблокированные товары имеют иконку замка в строке с tooltip «Заблокировано на WB: ZERO».
- **Карточка товара**: блок «Артикулы на площадках» — список существующих маппингов с кнопками «Добавить» и «Удалить».
- **UX-правило**: блокировка ставится и снимается без перезагрузки страницы (оптимистичный update + rollback при ошибке).
- **UX-правило**: настройки видимости сохраняются немедленно (PATCH + debounce), без кнопки «Сохранить».

## 8. Модель данных (PostgreSQL)

### `stock_channel_locks`
```
id            UUID PK
tenant_id     UUID NOT NULL  → tenants.id
product_id    UUID NOT NULL  → products.id
marketplace   ENUM(WB, OZON) NOT NULL
lock_type     ENUM(ZERO, FIXED, PAUSED) NOT NULL
fixed_value   INT NULL                     -- только для FIXED
note          TEXT NULL
created_by    UUID NULL  → users.id
created_at    TIMESTAMPTZ DEFAULT NOW()
updated_at    TIMESTAMPTZ

UNIQUE(tenant_id, product_id, marketplace)
INDEX(tenant_id, marketplace)
INDEX(tenant_id, product_id)
```

### `channel_visibility_settings` (или JSON-поле в tenant_settings)
```
tenant_id              UUID PK  → tenants.id
visible_marketplaces   TEXT[]   -- ['WB', 'OZON']
updated_at             TIMESTAMPTZ
```

### `product_channel_mappings` (существующая, без изменений схемы)
```
-- Уже реализована в schema.prisma как ProductChannelMapping
-- Новая логика: добавить endpoint для detach + GET by productId
```

## 9. Сценарии и алгоритмы (step-by-step)

### Алгоритм push_stocks с блокировкой
```
для каждого (productId, marketplace) в push batch:
  1. SELECT * FROM stock_channel_locks WHERE tenant_id=? AND product_id=? AND marketplace=?
  2. если lock найден:
       ZERO   → отправить qty=0 на маркетплейс
       FIXED  → отправить qty=lock.fixed_value на маркетплейс
       PAUSED → пропустить товар, не включать в push payload
  3. если lock не найден → отправить реальный available баланс (штатный путь)
  4. записать lock_applied=true/false в SyncRunItem metadata
```

### Алгоритм создания блокировки
1. Валидация: product существует в тенанте, marketplace аккаунт активен.
2. Для FIXED: `fixed_value >= 0`.
3. `INSERT OR UPDATE` в `stock_channel_locks` (upsert по unique key).
4. Emit audit event `STOCK_LOCK_CREATED`.
5. Вернуть созданный lock.

### Алгоритм снятия блокировки
1. Найти lock по `lockId` или по `(productId, marketplace)`.
2. `DELETE` из `stock_channel_locks`.
3. Emit audit event `STOCK_LOCK_REMOVED`.
4. Следующий push_stocks пройдёт штатным путём.

## 10. Валидации и ошибки

- `lockType = FIXED` требует `fixedValue >= 0`.
- Нельзя создать блокировку для несуществующего товара или неактивного marketplace аккаунта.
- Один товар + один маркетплейс = максимум одна блокировка (upsert).
- `visibleMarketplaces` — только значения из enum `MarketplaceType`; пустой массив запрещён (минимум один канал).
- Маппинг (склейка): externalProductId уникален в рамках (tenantId, marketplace).

Коды ошибок:
- `NOT_FOUND: PRODUCT_NOT_FOUND`
- `NOT_FOUND: STOCK_LOCK_NOT_FOUND`
- `CONFLICT: STOCK_LOCK_ALREADY_EXISTS` (при дублирующем create без upsert)
- `VALIDATION_ERROR: FIXED_VALUE_MUST_BE_NON_NEGATIVE`
- `FORBIDDEN: MARKETPLACE_ACCOUNT_NOT_ACTIVE`
- `CONFLICT: MAPPING_ALREADY_EXISTS`
- `VALIDATION_ERROR: VISIBLE_MARKETPLACES_CANNOT_BE_EMPTY`

## 11. Чеклист реализации

- [x] Миграция: таблица `stock_channel_locks` — `20260429010000_add_stock_channel_lock_and_visibility`.
- [x] Миграция: `channel_visibility_settings` — JSON-поле `channelVisibilitySettings` в `InventorySettings`.
- [x] `StockChannelLockModule` с сервисом и контроллером — `apps/api/src/modules/stock-locks/`.
- [x] Хук в push_stocks pipeline — `sync.service.ts` интегрирован с `StockLocksService`, batch-lookup + `_applyStockLocks` helper (TASK_CHANNEL_3).
- [x] `ChannelVisibilityModule` или endpoint в marketplace settings (TASK_CHANNEL_5: GET/PATCH /inventory/channel-visibility).
- [x] Улучшение API маппинга: GET by productId, DELETE mapping (TASK_CHANNEL_4).
- [x] Audit events для locks — `STOCK_LOCK_CREATED`, `STOCK_LOCK_REMOVED` в каталоге и контракте покрытия.
- [x] Frontend: lock management UI в таблице остатков (TASK_CHANNEL_6).
- [x] Frontend: channel visibility toggle (TASK_CHANNEL_6).
- [x] Frontend: mapping UI в карточке товара (TASK_CHANNEL_6).
- [x] QA: unit-тесты StockChannelLockService.
- [x] QA: интеграционные тесты push_stocks с блокировками.

## 12. Критерии готовности (DoD)

- Push_stocks не перезаписывает вручную заблокированные значения.
- Настройки видимости применяются мгновенно и не влияют на данные.
- Пользователь может связать артикулы с разных площадок без обращения в поддержку.
- Все операции с блокировками отражаются в audit log.

## 13. Тестовая матрица

- Создание ZERO-блокировки → push_stocks отправляет 0.
- Создание FIXED(15)-блокировки → push_stocks отправляет 15.
- PAUSED-блокировка → товар исключён из push payload.
- Снятие блокировки → следующий push отправляет реальный баланс.
- Попытка FIXED с negative value → 400.
- Создание блокировки для неактивного marketplace аккаунта → 403.
- Попытка создать дублирующий маппинг → 409.
- Скрытие канала → колонки исчезают из таблицы, данные и sync не затронуты.
- Пустой visibleMarketplaces → 422.
- Ручная склейка → товар показывает оба артикула, суммарный остаток агрегирован.

## 14. Observability, метрики и алерты

- Метрики: `stock_locks_active_count`, `stock_locks_created_total`, `stock_locks_removed_total`, `push_stocks_skipped_by_lock`, `push_stocks_overridden_by_lock`.
- Логи: lock created/removed с actor, productId, marketplace; push item overridden by lock.
- Алерты: аномальный рост `push_stocks_skipped_by_lock` (массовая заморозка без явного действия пользователя).

## 15. Фазы внедрения

1. DB-миграция `stock_channel_locks` + `channel_visibility_settings`.
2. Backend API блокировок + хук в push_stocks.
3. Backend улучшения маппинга + API видимости.
4. Frontend: UI блокировок, видимости и склейки.
5. QA, audit и observability.

## 16. Нефункциональные требования и SLA

- Проверка блокировки в push_stocks: в одну SELECT по индексу `(tenant_id, product_id, marketplace)` — не более 5 мс p99.
- Таблица остатков с фильтром видимости загружается без отдельного round-trip (настройки передаются вместе с основным запросом).
- Все операции идемпотентны: повторное создание блокировки с теми же параметрами обновляет, но не создаёт дубль.

## 17. Риски реализации и архитектурные замечания

- Главный риск: хук в push_stocks добавляет N SELECT для N товаров — нужен batch lookup по `(tenant_id, marketplace)` вместо поштучного запроса, чтобы не деградировать производительность sync.
- Риск: PAUSED-блокировка при длительном use может привести к drift между реальным остатком и тем, что видит маркетплейс — нужно отображать предупреждение в UI о том, как давно блокировка активна.
- Склейка: при merge двух продуктов в один нужно корректно перенести все связанные `StockBalance`, `StockMovement`, `OrderItem` — `mergeProducts` в `mapping.service.ts` это уже учитывает, но нужна проверка.

## 18. Открытые вопросы к продукту и архитектуре

- [ ] OQ-01: Видимость каналов — на уровне тенанта или на уровне пользователя?
- [ ] OQ-02: PAUSED блокировка — маркетплейс ожидает обновление или просто не получает его? Нужно уточнить контракт с API WB/Ozon.
- [ ] OQ-03: Нужен ли автоматический снять блокировки при деактивации маркетплейс-аккаунта?

## 19. Подтверждённые решения

- Batch lookup блокировок при push_stocks: `SELECT * FROM stock_channel_locks WHERE tenant_id=? AND marketplace=?` один раз на синк-батч, затем in-memory lookup.
- `ChannelVisibilitySettings` хранить как JSON-поле в существующей `tenant_settings` таблице (не отдельная таблица).
- Upsert семантика для `stock_channel_locks`: повторный POST обновляет тип и значение.

## 20. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-29 | Первоначальное создание документа | Anvar |
| 2026-04-29 | TASK_CHANNEL_4 выполнена: getMappingsByProduct, GET /catalog/mappings/product/:productId, DELETE возвращает 204, channelMappings в findOne | Anvar |
| 2026-04-29 | TASK_CHANNEL_5 выполнена: UpdateChannelVisibilityDto, getChannelVisibility + updateChannelVisibility (OWNER/ADMIN), GET/PATCH /inventory/channel-visibility | Anvar |
| 2026-04-29 | TASK_CHANNEL_6 выполнена: stockLocks.ts + channelVisibility.ts API-хелперы; lock UI + channel visibility dropdown в Inventory.tsx; mapping UI (склейка артикулов) в Products.tsx | Anvar |
| 2026-04-29 | TASK_CHANNEL_7 выполнена: 4 новых spec-файла (30 тестов); исправлены 7 pre-existing регрессий (logAction→writeEvent, findUnique→findFirst, новые DI-зависимости); итог — 71 suite / 1270 tests passed | Anvar |
