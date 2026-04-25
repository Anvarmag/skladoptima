# Склады — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `07-warehouses`

## 1. Назначение модуля

Модуль предоставляет справочник складов, подтягиваемых из внешних каналов, и их использование в inventory-представлении (FBS/FBO раздельно).

### Текущее состояние (as-is)

- в текущем коде нет самостоятельного warehouses backend-модуля и отдельной страницы справочника складов;
- warehouse данные появляются косвенно через marketplace sync/settings контур и не выделены в полноценный reference layer;
- нормализация FBS/FBO и lifecycle inactive складов пока формализованы в документации сильнее, чем в коде.

### Целевое состояние (to-be)

- warehouses должны стать отдельным reference слоем для inventory, orders и sync;
- тип исполнения и источник склада должны нормализоваться независимо от marketplace-specific представления;
- история связей со складом не должна теряться даже после деактивации или исчезновения из внешнего API;
- справочник складов должен оставаться read-only по внешним атрибутам и зависеть от состояния marketplace account и tenant, но допускать локальные tenant-метки и alias без изменения external truth.


## 2. Функциональный контур и границы

### Что входит в модуль
- хранение справочника внешних складов tenant;
- нормализация warehouse metadata из marketplace API;
- классификация FBS/FBO и вспомогательных атрибутов;
- lifecycle reference records: active, inactive, archived;
- отдача warehouse scope в inventory и UI;
- объяснение пользователю, почему склад неактуален или недоступен.

### Что не входит в модуль
- расчет остатков и транзакции stock movement;
- логика заказов и fulfillment исполнения;
- физические операции WMS;
- полноценный MDM по логистическим объектам.

### Главный результат работы модуля
- внешние склады представлены в системе как единый справочник, на который можно безопасно ссылаться в inventory, orders и аналитике.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Sync/Marketplace adapters | Импортируют данные складов | Источник истины по raw metadata |
| Owner/Admin/Manager | Просматривают и используют склад в UI | Могут задавать только внутренние alias/labels, не редактируя внешние идентификаторы |
| Inventory module | Использует warehouse reference | Не владеет жизненным циклом справочника |
| Support/Admin | Диагностируют проблемные mappings | Не должны ломать внешнюю связность без причины |

## 4. Базовые сценарии использования

### Сценарий 1. Первичная загрузка складов
1. При первом подключении account запускается warehouse sync.
2. Внешние записи нормализуются в internal warehouse model.
3. Каждому складу присваивается tenant scope и marketplace account scope.
4. UI получает список складов для работы с остатками.

### Сценарий 2. Обновление справочника
1. Регулярный sync получает актуальный список складов.
2. Существующие записи upsert-ятся по external id.
3. Пропавшие склады переводятся в inactive/archived по политике.
4. Исторические связи с inventory не теряются.

### Сценарий 3. Классификация FBS/FBO
1. Adapter получает тип склада из API или derive rule.
2. Сервис нормализует значение в внутренний enum.
3. Inventory/Orders используют эту классификацию для бизнес-логики.

## 5. Зависимости и интеграции

- Marketplace Accounts (источник складов)
- Sync (периодическое обновление справочника)
- Inventory (остатки в разрезе складов)
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/warehouses` | User | Список складов tenant |
| `GET` | `/api/v1/warehouses/:warehouseId` | User | Карточка склада |
| `GET` | `/api/v1/warehouses/:warehouseId/stocks` | User | Остатки по складу |
| `PATCH` | `/api/v1/warehouses/:warehouseId/metadata` | Owner/Admin/Manager | Обновление внутренних alias/labels |
| `POST` | `/api/v1/warehouses/sync` | Owner/Admin | Ручной refresh справочника складов |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/warehouses?marketplace=WB&type=FBS' \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "items": [
    {
      "id": "wh_...",
      "name": "WB Коледино",
      "city": "Москва",
      "type": "FBS",
      "marketplace": "WB"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

### Frontend поведение

- Текущее состояние: в web-клиенте нет выделенной страницы склада и фильтрации по warehouse type.
- Целевое состояние: нужен справочник складов с фильтрами по аккаунту, типу, активности и источнику.
- UX-правило: FBS и FBO не должны визуально смешиваться, иначе downstream inventory интерпретация будет ошибочной.
- inactive/archived склад должен оставаться видимым как reference-объект с понятным статусом;
- пользователь может задать внутренний alias и labels для удобства поиска и группировки, но не может менять внешний тип, источник и external id;
- при `TRIAL_EXPIRED` справочник складов доступен для чтения, но ручной refresh из UI запрещен;
- при `SUSPENDED` и `CLOSED` пользователь видит только read-only состояние без запуска refresh и действий, требующих внешнего API.

## 8. Модель данных (PostgreSQL)

### `warehouses`
- `id UUID PK`, `tenant_id UUID`
- `marketplace_account_id UUID FK`
- `external_warehouse_id VARCHAR(128) NOT NULL`
- `name VARCHAR(255) NOT NULL`, `city VARCHAR(128) NULL`
- `warehouse_type ENUM(fbs, fbo)`
- `source_marketplace ENUM(wb, ozon, yandex_market)`
- `alias_name VARCHAR(255) NULL`
- `labels TEXT[] NOT NULL DEFAULT '{}'`
- `status ENUM(active, inactive, archived) NOT NULL DEFAULT 'active'`
- `deactivation_reason VARCHAR(64) NULL`
- `last_synced_at TIMESTAMPTZ`
- `first_seen_at TIMESTAMPTZ NOT NULL`
- `inactive_since TIMESTAMPTZ NULL`
- `metadata_updated_at TIMESTAMPTZ NULL`
- `metadata_updated_by UUID NULL`
- `UNIQUE(tenant_id, marketplace_account_id, external_warehouse_id)`

## 9. Сценарии и алгоритмы (step-by-step)

1. Sync job получает список складов из каждого account.
2. Выполняется upsert `warehouses` по `(tenant, account, external_id)`.
3. Тип FBS/FBO вычисляется правилами интеграции и сохраняется явно.
4. Если склад пропал из внешнего API, он переводится в `inactive`, а не удаляется сразу.
5. Пользовательские `alias_name` и `labels` хранятся отдельно от sync-полей и не перетираются внешней синхронизацией.
6. Inventory API использует `warehouse_type` и `status` для раздельного отображения.

## 10. Валидации и ошибки

- Ручное создание/удаление складов через API запрещено в MVP.
- Ручное изменение `external_warehouse_id`, `warehouse_type`, `source_marketplace`, `name/city` из внешнего канала запрещено в MVP.
- Разрешено менять только `alias_name` и `labels` внутри tenant scope.
- Ручной refresh через UI запрещен при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
- Ошибки:
  - `NOT_FOUND: WAREHOUSE_NOT_FOUND`
  - `FORBIDDEN: WAREHOUSE_REFRESH_BLOCKED_BY_TENANT_STATE`
  - `VALIDATION_ERROR: WAREHOUSE_METADATA_TOO_LONG`
  - `EXTERNAL_INTEGRATION_ERROR: WAREHOUSE_SYNC_FAILED`

## 11. Чеклист реализации

- [ ] Таблица `warehouses`.
- [ ] Sync use-case `refresh warehouses`.
- [ ] API read-only для списка/деталей.
- [ ] API для обновления `alias_name` и `labels`.
- [ ] Привязка к inventory UI и фильтрам.

## 12. Критерии готовности (DoD)

- Складской справочник полностью подтягивается из каналов.
- FBS/FBO не смешиваются в отображении.
- Модуль не изменяет внешние складские сущности маркетплейса.
- Внутренние alias/labels не ломают внешний mapping и не теряются после sync.
- Исторические склады не теряются после исчезновения из внешнего API.

## 13. Lifecycle warehouse reference

### Состояния
- `ACTIVE`
- `INACTIVE`
- `ARCHIVED`

### Переходы
- первичная синхронизация -> `ACTIVE`
- склад временно исчез из API или account перестал быть рабочим -> `INACTIVE`
- safe-window истек -> `ARCHIVED`

### Инварианты
- склад не является tenant-owned сущностью редактирования на MVP;
- локально редактируются только `alias_name` и `labels`, но не external metadata;
- любой warehouse всегда связан с конкретным `marketplace_account_id`;
- один и тот же внешний склад из разных account считается разными связями;
- переименование и удаление внешнего склада внутри платформы запрещены.

## 14. Схема обновления справочника

1. Worker получает warehouses из account API.
2. Нормализует ответ в канонический DTO.
3. Выполняет upsert в `warehouses`.
4. Для более не возвращаемых складов ставит `status=inactive` только после safe-window, а не мгновенно.
5. Долго не возвращающиеся склады переводятся в `archived`.

## 15. Контракты с inventory

### Read-model для inventory UI
- `warehouse_id`
- `warehouse_type`
- `source_marketplace`
- `city`
- `alias_name`
- `labels`
- `status`
- `deactivation_reason`

### Для детализации по складу
- inventory layer должен уметь агрегировать остатки в разрезе `warehouse_id`

### Правила интерпретации
- `ACTIVE` склады участвуют в стандартных operational views;
- `INACTIVE` и `ARCHIVED` не должны маскироваться под актуальный рабочий контур;
- inventory не должен терять исторические ссылки на склад, даже если он больше не приходит из внешнего API.

## 16. Тестовая матрица

- Первичная загрузка складов.
- Повторная синхронизация без дублей.
- Изменение названия склада во внешнем канале.
- Изменение `alias_name` и `labels` без влияния на sync identity.
- Исчезновение склада из API.
- Корректное разделение FBS/FBO.
- Переход `ACTIVE -> INACTIVE -> ARCHIVED`.
- Блокировка ручного refresh в `TRIAL_EXPIRED`.
- Блокировка ручного refresh в `SUSPENDED/CLOSED`.

## 17. Фазы внедрения

1. Таблица `warehouses`.
2. Sync use-case и нормализация ответов каналов.
3. Read API для UI.
4. Детализация stock-by-warehouse.

## 18. Нефункциональные требования и SLA

- Обновление справочника складов должно выполняться асинхронно и не блокировать пользовательские операции.
- Read API справочника должен быть быстрым: `p95 < 300 мс`.
- Внешние идентификаторы складов должны быть immutable в рамках account scope.
- Исторические ссылки на warehouse не должны теряться даже при его деактивации.
- Warehouse normalization должна быть идемпотентной и давать одинаковый результат при повторной синхронизации одного и того же ответа API.

## 19. Observability, логи и алерты

- Метрики: `warehouses_synced`, `warehouse_upserts`, `inactive_warehouses`, `classification_changes`, `freshness_lag`.
- Логи: import/upsert результатов, типовые ошибки normalization, account-specific anomalies.
- Алерты: отсутствие обновления справочника, массовые type changes, рост unknown classification.
- Dashboards: warehouse coverage, freshness by account, FBS/FBO distribution.

## 20. Риски реализации и архитектурные замечания

- Справочник складов не должен стать “вторым inventory”; его ответственность только reference/model layer.
- При изменении внешних атрибутов нужна стабильная нормализация, иначе downstream-модули будут дергаться от шума.
- Нужно заранее описать жизненный цикл disappeared warehouse, чтобы не было произвольного hard delete.
- Если один marketplace возвращает неоднозначные типы складов, классификация должна быть explainable и versioned.
- Пользовательские alias/labels допустимы только как локальная надстройка; если дать им право менять внешнюю идентичность склада, модуль начнет смешивать external truth и внутреннюю ручную семантику.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю warehouses больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Warehouse lifecycle и его связь с inventory описаны явно.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Доработаны warehouse lifecycle, tenant-state guards и открытый вопрос по внутренним меткам складов | Codex |
| 2026-04-18 | Подтверждены внутренние alias/labels для складов как локальная tenant-метадата без изменения external truth | Codex |
