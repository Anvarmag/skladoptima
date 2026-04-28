# TASK_CATALOG_2 — CRUD Products, Soft Delete и Restore

> Модуль: `05-catalog`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_CATALOG_1`
  - согласован `17-files-s3`
- Что нужно сделать:
  - реализовать create/list/detail/update/delete/restore для товаров;
  - требовать минимум `name + sku` в MVP;
  - реализовать soft delete без потери ссылочной истории зависимых модулей;
  - поддержать reuse SKU после soft delete только через warning + explicit confirm;
  - связать товар с `main_image_file_id` без поломки карточки при замене медиа.
- Критерий закрытия:
  - CRUD работает по agreed contract;
  - soft delete и restore не ломают связанные модули;
  - сценарий reuse SKU после soft delete реализован одинаково и прозрачно.

**Что сделано**

**Дата выполнения:** 2026-04-26

### 1. PRODUCT_RESTORED в ActionType + миграция
- Добавлен `PRODUCT_RESTORED` в enum `ActionType` (schema.prisma)
- Миграция `20260426060000_catalog_crud_restore/migration.sql`: `ALTER TYPE "ActionType" ADD VALUE 'PRODUCT_RESTORED'`
- Теперь restore-операции логируются отдельным типом, не смешиваются с `PRODUCT_CREATED`

### 2. SKU reuse — warning + explicit confirm flow
**Старое поведение:** создание товара с SKU soft-deleted продукта → тихое автовосстановление без предупреждения.

**Новое поведение (двухшаговый flow):**
1. `POST /products` с SKU soft-deleted товара → **409 Conflict** с телом:
   ```json
   { "code": "SKU_SOFT_DELETED", "deletedProductId": "uuid", "message": "..." }
   ```
2. `POST /products` с `confirmRestoreId: "uuid"` → восстанавливает товар с новыми данными, логирует `PRODUCT_RESTORED`

Если `confirmRestoreId` не совпадает с id удалённого товара → **400 CONFIRM_RESTORE_ID_MISMATCH**.
Если SKU принадлежит активному товару → **409 SKU_ALREADY_EXISTS**.

### 3. Restore endpoint
- Добавлен `POST /products/:id/restore` (HTTP 200)
- Находит товар включая soft-deleted (`includeDeleted=true`)
- Если товар не удалён → **409 PRODUCT_ALREADY_ACTIVE**
- Устанавливает `deletedAt=null, status=ACTIVE, updatedBy`
- Логирует `PRODUCT_RESTORED` в AuditLog

### 4. PATCH метод для update
- Добавлен `PATCH /products/:id` как основной метод частичного обновления
- `PUT /products/:id` оставлен как backward-compatible alias (роутит в тот же сервисный метод)
- Логика update переписана на явные spread-операторы: если поле не пришло — не меняется (не нужно хранить old values для каждого поля)

### 5. mainImageFileId в create/update
- `CreateProductDto`: добавлен `@IsUUID() mainImageFileId?: string`
- `UpdateProductDto`: добавлен `@IsUUID() mainImageFileId?: string`
- Сервис передаёт `mainImageFileId` в `create` и `update`
- При замене фото (`photo`) `mainImageFileId` не затрагивается → карточка не ломается при смене медиа

### 6. Стандартизация кодов ошибок
Все ошибки теперь возвращают структурированный `{ code, message }`:
- `SKU_ALREADY_EXISTS` — активный дубль SKU
- `SKU_SOFT_DELETED` — soft-deleted дубль (требует confirm)
- `CONFIRM_RESTORE_ID_MISMATCH` — confirmRestoreId не совпадает
- `PRODUCT_NOT_FOUND` — товар не найден или чужой tenant
- `PRODUCT_ALREADY_ACTIVE` — попытка restore активного товара
- `STOCK_CANNOT_BE_NEGATIVE` — отрицательный остаток

### 7. Мелкие улучшения
- `findOne()` принимает `includeDeleted = false` — теперь restore может найти удалённый товар без дублирования запроса
- `findAll()` поиск расширен на поле `brand`
- Дублированный код multer вынесен в переменную `photoUpload`
- Обработчик onboarding вынесен в приватный `_triggerOnboardingAddProducts()`
- `adjustStock` и `update` теперь возвращают `available` в ответе

### Критерии закрытия — выполнено
- [x] CRUD работает по agreed contract (create, list, detail, PATCH/PUT, DELETE, restore)
- [x] soft delete и restore не ломают связанные модули (deletedAt + status, referential history сохраняется)
- [x] сценарий reuse SKU после soft delete реализован одинаково и прозрачно (2-шаговый flow с 409 warning)
