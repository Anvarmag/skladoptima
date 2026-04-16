# Склады — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль предоставляет справочник складов, подтягиваемых из внешних каналов, и их использование в inventory-представлении (FBS/FBO раздельно).

## 2. Функциональный контур и границы

### Что входит в модуль
- хранение справочника внешних складов tenant;
- нормализация warehouse metadata из marketplace API;
- классификация FBS/FBO и вспомогательных атрибутов;
- lifecycle reference records: active, inactive, archived;
- отдача warehouse scope в inventory и UI.

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
| Owner/Admin/Manager | Просматривают и используют склад в UI | Обычно не редактируют внешние идентификаторы |
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

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/warehouses` | User | Список складов tenant |
| `GET` | `/api/v1/warehouses/:warehouseId` | User | Карточка склада |
| `GET` | `/api/v1/warehouses/:warehouseId/stocks` | User | Остатки по складу |
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

## 8. Модель данных (PostgreSQL)

### `warehouses`
- `id UUID PK`, `tenant_id UUID`
- `marketplace_account_id UUID FK`
- `external_warehouse_id VARCHAR(128) NOT NULL`
- `name VARCHAR(255) NOT NULL`, `city VARCHAR(128) NULL`
- `warehouse_type ENUM(fbs, fbo)`
- `source_marketplace ENUM(wb, ozon, yandex_market)`
- `is_active BOOLEAN DEFAULT true`
- `last_synced_at TIMESTAMPTZ`
- `UNIQUE(tenant_id, marketplace_account_id, external_warehouse_id)`

## 9. Сценарии и алгоритмы (step-by-step)

1. Sync job получает список складов из каждого account.
2. Выполняется upsert `warehouses` по `(tenant, account, external_id)`.
3. Тип FBS/FBO вычисляется правилами интеграции и сохраняется явно.
4. Inventory API использует `warehouse_type` для раздельного отображения.

## 10. Валидации и ошибки

- Ручное создание/удаление складов через API запрещено в MVP.
- Ошибки:
  - `NOT_FOUND: WAREHOUSE_NOT_FOUND`
  - `EXTERNAL_INTEGRATION_ERROR: WAREHOUSE_SYNC_FAILED`

## 11. Чеклист реализации

- [ ] Таблица `warehouses`.
- [ ] Sync use-case `refresh warehouses`.
- [ ] API read-only для списка/деталей.
- [ ] Привязка к inventory UI и фильтрам.

## 12. Критерии готовности (DoD)

- Складской справочник полностью подтягивается из каналов.
- FBS/FBO не смешиваются в отображении.
- Модуль не изменяет внешние складские сущности маркетплейса.

## 13. Бизнес-правила хранения складов

- Склад не является tenant-owned сущностью редактирования на MVP.
- Любой warehouse всегда связан с конкретным `marketplace_account_id`.
- Один и тот же внешний склад из разных account считается разными связями.
- Переименование и удаление внешнего склада внутри платформы запрещены.

## 14. Схема обновления справочника

1. Worker получает warehouses из account API.
2. Нормализует ответ в канонический DTO.
3. Выполняет upsert в `warehouses`.
4. Ставит `is_active=false` для более не возвращаемых складов только после safe-window, а не мгновенно.

## 15. Контракты с inventory

### Read-model для inventory UI
- `warehouse_id`
- `warehouse_type`
- `source_marketplace`
- `city`
- `is_active`

### Для детализации по складу
- inventory layer должен уметь агрегировать остатки в разрезе `warehouse_id`

## 16. Тестовая матрица

- Первичная загрузка складов.
- Повторная синхронизация без дублей.
- Изменение названия склада во внешнем канале.
- Исчезновение склада из API.
- Корректное разделение FBS/FBO.

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
