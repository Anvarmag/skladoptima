# TASK_CHANNEL_4 — Backend API улучшений маппинга (склейка артикулов)

> Модуль: `21-channel-controls`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `4h`
- Зависимости:
  - существующий `MappingService` в `apps/api/src/modules/catalog/mapping.service.ts`
  - `ProductChannelMapping` модель в schema.prisma (уже реализована)
- Что нужно сделать:
  - добавить в `MappingService` метод `getMappingsByProduct(tenantId, productId)` — возвращает все маппинги для конкретного товара сразу (WB + Ozon + любые другие), с полями `marketplace`, `externalProductId`, `externalSku`, `isAutoMatched`, `createdAt`;
  - добавить метод `detachMapping(tenantId, mappingId)` — удалить маппинг; проверить что маппинг принадлежит тенанту;
  - добавить в `MappingController` эндпоинты:
    - `GET /api/v1/catalog/products/:productId/mappings` → список маппингов товара;
    - `DELETE /api/v1/catalog/mappings/:mappingId` → отвязать артикул;
  - добавить audit события `MAPPING_CREATED` и `MAPPING_REMOVED` через `AuditService` (если ещё не добавлены в catalog);
  - убедиться что существующий `manualMapping` корректно обрабатывает конфликт (уже связанный externalProductId) с ошибкой `CONFLICT: MAPPING_ALREADY_EXISTS`;
  - добавить в ответ `GET /api/v1/catalog/products/:productId` (если есть) поле `channelMappings` с кратким списком маппингов.
- Критерий закрытия:
  - `GET /api/v1/catalog/products/:productId/mappings` возвращает все маппинги товара с marketplace и externalProductId;
  - `DELETE /api/v1/catalog/mappings/:mappingId` удаляет маппинг и возвращает 204;
  - попытка удалить маппинг чужого тенанта возвращает 404;
  - попытка создать дублирующий маппинг возвращает 409 с описанием конфликта;
  - audit события присутствуют при create и remove.

**Что сделано**

### Реализованные изменения

#### 1. `apps/api/src/modules/catalog/mapping.service.ts`

- Добавлен метод `getMappingsByProduct(tenantId, productId)`:
  - Проверяет существование товара в тенанте (404 если не найден)
  - Возвращает `{ data: [...] }` со всеми маппингами товара: `id`, `marketplace`, `externalProductId`, `externalSku`, `isAutoMatched`, `createdAt`
  - Сортировка по `createdAt asc`
- Обновлён существующий метод `deleteMapping` — изменён тип возврата на `Promise<void>` (возвращал `{ message: '...' }`, теперь не возвращает ничего, чтобы поддержать 204 на уровне контроллера)

#### 2. `apps/api/src/modules/catalog/mapping.controller.ts`

- Добавлен эндпоинт `GET /api/catalog/mappings/product/:productId` → вызывает `getMappingsByProduct`; параметр `productId` валидируется через `ParseUUIDPipe`
- Добавлен `@HttpCode(HttpStatus.NO_CONTENT)` к существующему `DELETE /api/catalog/mappings/:id` — теперь возвращает 204 вместо 200

#### 3. `apps/api/src/modules/catalog/product.service.ts`

- Обновлён метод `findOne` — теперь использует `include: { channelMappings: { select: { id, marketplace, externalProductId, externalSku, isAutoMatched, createdAt }, orderBy: { createdAt: 'asc' } } }`
- Карточка товара (`GET /api/products/:id`) теперь содержит поле `channelMappings` — список связанных артикулов по всем маркетплейсам

### Что уже было реализовано до задачи (проверено)

- `MARKETPLACE_MAPPING_CREATED` и `MARKETPLACE_MAPPING_DELETED` — audit события существуют в каталоге и вызываются в `createManual`, `autoMatch`, `deleteMapping`
- `ConflictException` с `code: 'MAPPING_ALREADY_EXISTS'` в `createManual` — обрабатывает дублирующий маппинг корректно
- Tenant-scope проверка в `deleteMapping` — маппинг чужого тенанта → 404

### Маршруты API после задачи

| Метод | Путь | Назначение |
|-------|------|------------|
| `GET` | `/api/catalog/mappings/product/:productId` | Все маппинги товара |
| `DELETE` | `/api/catalog/mappings/:id` | Удалить маппинг (204) |
| `POST` | `/api/catalog/mappings/manual` | Создать маппинг вручную (409 при конфликте) |
| `GET` | `/api/products/:id` | Карточка товара + `channelMappings[]` |
