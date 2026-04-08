# Каталог товаров — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `05-catalog`

## 1. Назначение модуля

Модуль управляет единым каталогом товаров tenant: создание, редактирование, soft delete/restore, импорт, сопоставление с маркетплейсами, поиск и фильтрация.

### Текущее состояние (as-is)

- в backend уже есть модуль `catalog` с product CRUD, import и stock-adjust endpoint;
- во frontend уже существует страница `Products`, которая закрывает базовый каталоговый сценарий;
- при этом import preview/commit, product mappings и media lifecycle пока описаны глубже в документации, чем в текущей реализации.

### Целевое состояние (to-be)

- catalog должен стать master-source товарной модели для inventory, orders, finance и analytics;
- import обязан быть двухфазным: preview и commit на одной нормализованной staging модели;
- модуль должен включать mappings, product media и четкую архивную политику без потери истории;
- все write-операции каталога должны уважать tenant `AccessState`, чтобы read-only/suspended tenant не менял master-каталог.


## 2. Функциональный контур и границы

### Что входит в модуль
- master-каталог товаров tenant;
- CRUD карточек товара;
- import и preview import из внешних источников;
- связывание внутренних SKU с внешними marketplace items;
- soft delete и восстановление карточек;
- хранение главных бизнес-атрибутов товара для inventory/orders/finance;
- source-of-change policy между ручным редактированием, import и sync.

### Что не входит в модуль
- физическое хранение файлов медиа;
- расчет остатков и резервов;
- расчет финансовых показателей;
- маркетинговый контент для лендинга или PIM-класса функциональность.

### Главный результат работы модуля
- у tenant есть единый нормализованный каталог, к которому привязаны остатки, заказы, финансовые расчеты и marketplace mappings.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin | Управляет каталогом и import | Может создавать, архивировать, маппить |
| Manager | Работает с товарами по политике | Часто read/write без критичных настроек |
| Sync/Marketplace adapters | Поставляют внешние данные для matching/import | Не должны напрямую ломать master-каталог и перетирать поля без policy |
| Finance/Inventory | Читают product master | Не владеют жизненным циклом товара |

## 4. Базовые сценарии использования

### Сценарий 1. Ручное создание товара
1. Пользователь открывает create form.
2. Backend валидирует обязательные атрибуты и уникальность SKU.
3. Создается product card в master-каталоге.
4. При необходимости инициируется создание media/upload linkage и дальнейших dependent records.

### Сценарий 2. Import с preview
1. Пользователь загружает файл/инициирует import.
2. Backend создает import job и парсит строки в preview-модель.
3. Система показывает valid, invalid, duplicate и auto-match rows.
4. Пользователь подтверждает commit.
5. Commit создает/обновляет товары и mappings идемпотентно.

### Сценарий 3. Связывание внешнего товара с внутренним SKU
1. Sync/import слой обнаруживает внешний item.
2. Система пытается auto-match по правилам.
3. При неуспехе пользователь выполняет manual mapping.
4. Mapping сохраняется и далее используется для orders/stocks sync.

## 5. Зависимости и интеграции

- Inventory (остатки)
- Marketplace Accounts + Sync (импорт и mapping)
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)
- Files/S3 (главное фото)
- Audit

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/catalog/products` | Owner/Admin/Manager | Создать товар |
| `GET` | `/api/v1/catalog/products` | Owner/Admin/Manager/Staff | Список товаров |
| `GET` | `/api/v1/catalog/products/:productId` | User | Карточка товара |
| `PATCH` | `/api/v1/catalog/products/:productId` | Owner/Admin/Manager | Обновить товар |
| `DELETE` | `/api/v1/catalog/products/:productId` | Owner/Admin | Soft delete |
| `POST` | `/api/v1/catalog/products/:productId/restore` | Owner/Admin | Восстановить товар |
| `POST` | `/api/v1/catalog/imports/preview` | Owner/Admin | Preview импорта |
| `POST` | `/api/v1/catalog/imports/commit` | Owner/Admin | Подтвердить импорт |
| `GET` | `/api/v1/catalog/imports/:jobId` | Owner/Admin | Статус import job |
| `POST` | `/api/v1/catalog/mappings/manual` | Owner/Admin/Manager | Ручной match карточек |
| `GET` | `/api/v1/catalog/mappings/unmatched` | Owner/Admin/Manager | Список несопоставленных |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/catalog/products \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Кроссовки X","sku":"SKU-1001","brand":"BrandX","category":"Shoes"}'
```

```json
{
  "id": "prd_...",
  "name": "Кроссовки X",
  "sku": "SKU-1001",
  "status": "ACTIVE"
}
```

### Frontend поведение

- Текущее состояние: в web-клиенте есть маршрут `/app` со страницей `Products` как основным каталоговым экраном.
- Целевое состояние: нужны развитые сценарии списка, карточки товара, импорта, unresolved mappings и media management.
- UX-правило: duplicate SKU, import errors и archive/restore должны объясняться пользователю в предметных терминах, а не через технические коды.
- при `TRIAL_EXPIRED` каталог остается доступным в read-only режиме без create/update/import/delete;
- при `SUSPENDED` и `CLOSED` любые catalog write-actions заблокированы, а UI должен показывать reason и CTA в billing/поддержку.

## 8. Модель данных (PostgreSQL)

### `products`
- `id UUID PK`, `tenant_id UUID`
- `name VARCHAR(255) NOT NULL`
- `sku VARCHAR(128) NOT NULL`
- `brand VARCHAR(128) NULL`
- `category VARCHAR(128) NULL`
- `barcode VARCHAR(128) NULL`
- `main_image_file_id UUID NULL`
- `status ENUM(active, deleted)`
- `created_by UUID NULL`
- `updated_by UUID NULL`
- `source_of_truth ENUM(manual, import, sync) NOT NULL DEFAULT 'manual'`
- `created_at`, `updated_at`, `deleted_at`
- `UNIQUE(tenant_id, sku)`

### `product_channel_mappings`
- `id UUID PK`
- `tenant_id UUID`
- `product_id UUID FK products(id)`
- `marketplace ENUM(wb, ozon, yandex_market, site)`
- `external_product_id VARCHAR(128) NOT NULL`
- `external_sku VARCHAR(128) NULL`
- `is_auto_matched BOOLEAN`
- `created_at`, `updated_at`
- `UNIQUE(tenant_id, marketplace, external_product_id)`

### `catalog_import_jobs`
- `id UUID PK`, `tenant_id UUID`, `source ENUM(api_sync, excel)`
- `status ENUM(preview, processing, completed, failed, cancelled)`
- `total_rows`, `created_count`, `updated_count`, `error_count`
- `idempotency_key VARCHAR(128) NULL`
- `created_by UUID`, `created_at`, `finished_at`

### `catalog_import_job_items`
- `id UUID PK`, `job_id UUID FK`, `row_number INT`
- `raw_payload JSONB`, `validation_errors JSONB`, `action ENUM(create, update, skip)`

## 9. Сценарии и алгоритмы (step-by-step)

1. Создание товара: валидация обязательных полей, проверка уникальности SKU, запись `products`.
2. Импорт preview: загрузить файл/данные, валидировать строки, рассчитать `create/update/skip`.
3. Импорт commit: запуск job, upsert товаров, запись статистики ошибок.
4. Автосопоставление: сначала по SKU при надежном совпадении.
5. Ручной match: пользователь связывает внутренний товар и внешний `external_product_id`.
6. Soft delete: `deleted_at` без физического удаления связей/истории.
7. Любой write-path проверяет tenant `AccessState` перед изменением master-каталога.

## 10. Product lifecycle и source-of-change policy

### Product lifecycle
- `ACTIVE`
- `DELETED`

### Что означает `DELETED`
- товар скрыт из стандартного списка по умолчанию;
- исторические ссылки из inventory/orders/finance продолжают работать;
- новый товар с тем же SKU не должен создаваться автоматически без явного restore/resolve policy и пользовательского подтверждения.

### Source-of-change policy
- ручной edit может менять master-поля карточки;
- import может создавать и обновлять товары только по нормализованным правилам preview/commit;
- sync-layer не должен напрямую перезаписывать master-карточку вне import/mapping policy;
- конфликт ручного изменения и sync/import обновления должен быть диагностируемым, а не silent overwrite.

## 11. Валидации и ошибки

- `name`, `sku` обязательны.
- SKU уникален в tenant.
- Запрет удаления товара при отсутствии прав роли.
- Запрет catalog write-actions при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
- Нельзя soft-delete товар без сохранения ссылочной целостности зависимых модулей.
- при попытке создать новый товар с SKU, который уже был у soft-deleted карточки, система должна показать предупреждение и запросить явное подтверждение создания новой карточки;
- Ошибки:
  - `CONFLICT: SKU_ALREADY_EXISTS`
  - `VALIDATION_ERROR: IMPORT_ROW_INVALID`
  - `NOT_FOUND: PRODUCT_NOT_FOUND`
  - `FORBIDDEN: CATALOG_WRITE_BLOCKED_BY_TENANT_STATE`
  - `CONFLICT: PRODUCT_ALREADY_DELETED`
  - `FORBIDDEN: ROLE_NOT_ALLOWED`

## 12. Чеклист реализации

- [ ] Миграции catalog-таблиц.
- [ ] CRUD products + soft delete/restore.
- [ ] Import preview/commit pipeline.
- [ ] Mapping API auto/manual.
- [ ] Фильтры/поиск и пагинация.
- [ ] Guard write-actions по tenant access-state.
- [ ] Source-of-change policy для manual/import/sync.
- [ ] Аудит операций каталога.

## 13. Критерии готовности (DoD)

- Каталог поддерживает 3 канала наполнения: ручной, sync, excel.
- Дубли SKU не создаются.
- Несопоставленные товары видны и могут быть вручную связаны.
- ручной merge дублей доступен как дополнительный пользовательский сценарий.

## 14. Расширенный API payload contract

### `POST /catalog/products`
#### Request body
```json
{
  "name": "Кроссовки X",
  "sku": "SKU-1001",
  "brand": "BrandX",
  "category": "Shoes",
  "barcode": "4600000000012",
  "mainImageFileId": "fil_..."
}
```

### `GET /catalog/products`
#### Query params
- `page`, `limit`
- `search`
- `brand`
- `category`
- `status=active|deleted`
- `hasUnmatchedMappings=true|false`

### `POST /catalog/products` c reuse soft-deleted SKU
#### Поведение
- если найден soft-deleted товар с тем же `sku`, backend возвращает предупреждение/confirmation-required response;
- после явного подтверждения создается новая карточка, старая deleted-карточка не восстанавливается автоматически.

## 15. Нормализованная доменная модель

### Внутренний товар
- одна главная карточка внутри tenant
- единый внутренний SKU
- может иметь много channel mappings

### Внешняя карточка
- принадлежит конкретному marketplace account
- хранится как mapping, а не как отдельный root aggregate каталога

### Почему так
- не дублируем один и тот же товар на каждый канал
- сохраняем единый центр управления остатками и аналитикой

## 16. Import workflow детально

1. Пользователь загружает файл/запускает preview.
2. Backend создает `catalog_import_job(status=preview)`.
3. Каждая строка проходит нормализацию и валидацию.
4. Для каждой строки вычисляется действие: `create`, `update`, `skip`, `manual_review`.
5. После `commit` создается worker task на применение batch-операций.
6. Итоги пишутся в `catalog_import_jobs` и `catalog_import_job_items`.
7. Повторный commit с тем же `idempotency_key` не должен повторно создавать товары.
8. Если import встречает SKU soft-deleted товара, применяется та же restore/confirm policy, что и в ручном создании.

## 17. Тестовая матрица

- Создание товара с новым SKU.
- Создание товара с существующим SKU.
- Soft delete и restore.
- Создание новой карточки с SKU ранее soft-deleted товара после явного подтверждения.
- Import preview с валидными и невалидными строками.
- Повторный import тех же SKU.
- Auto-match по SKU.
- Ручной match external product.
- Ручной merge дублей.
- Попытка catalog write-action в `TRIAL_EXPIRED`.
- Попытка catalog write-action в `SUSPENDED/CLOSED`.
- Конфликт ручного edit и import update того же SKU.

## 18. Фазы внедрения

1. Core entities `products`, `product_channel_mappings`.
2. CRUD API и soft delete.
3. Import preview/commit + job items.
4. Mapping UI/API auto + manual.
5. Tenant-state guards и source-of-change policy.
6. Search/filter/index tuning и аудит.

## 19. Нефункциональные требования и SLA

- CRUD товара должен укладываться в `p95 < 500 мс`, import preview/commit выполняются асинхронно.
- Idempotent import обязателен: повторный commit одного и того же job/input не должен создавать дубли.
- SKU uniqueness и mapping integrity проверяются на backend и защищаются индексами/constraint-ами.
- Soft delete не должен приводить к каскадной потере ссылочной истории.
- Каталоговые write-guards должны срабатывать консистентно во всех entrypoint: UI, import и sync-driven flows.

## 20. Observability, логи и алерты

- Метрики: `products_created`, `products_archived`, `import_jobs_started`, `import_rows_invalid`, `auto_match_rate`, `mapping_conflicts`.
- Логи: import parsing, preview decisions, commit summary, mapping changes.
- Алерты: рост invalid import rows, массовые SKU conflicts, mapping duplication, failed import commit, write denials by tenant state.
- Dashboards: catalog growth, import health, unmatched/mapping conflict board, source-of-change conflict board.

## 21. Риски реализации и архитектурные замечания

- Нужно жестко разделить master product и external marketplace item, иначе система быстро потеряет целостность.
- Import preview и commit обязаны работать на одной нормализованной модели, а не на двух независимых реализациях.
- Ручной edit и sync-driven update не должны бесконтрольно перетирать друг друга; нужен source-of-change policy.
- Soft delete должен быть системным выбором: архивируем сущность, но не ломаем историю зависимых модулей.
- Если в `TRIAL_EXPIRED` оставить import или create открытыми, master-каталог начнет расходиться с tenant policy read-only.
- Reuse SKU после soft delete требует одинаковой policy и в ручном create, и в import, иначе пользователи получат разные результаты для одного и того же кейса.

## 22. Открытые вопросы к продукту и архитектуре

- На текущий момент открытых продуктовых вопросов по MVP catalog не осталось.

## 23. Подтвержденные продуктовые решения

- минимальный набор обязательных полей товара в MVP: `name + sku`;
- ручной merge дублей в MVP поддерживается как дополнительная пользовательская опция;
- если товар с тем же SKU уже был soft-deleted, допускается создание новой карточки, но только после явного предупреждения и подтверждения пользователя.

## 24. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Product lifecycle, source-of-change policy и tenant-state guards описаны явно.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 25. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Доработаны guards по tenant state, product lifecycle, source-of-change policy и открытые вопросы по полям/merge/SKU reuse | Codex |
| 2026-04-18 | Зафиксированы обязательные поля MVP, ручной merge дублей и policy создания нового товара после soft delete SKU | Codex |
