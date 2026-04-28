# TASK_CATALOG_3 — Import Preview, Commit и Idempotency

> Модуль: `05-catalog`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_CATALOG_1`
  - `TASK_CATALOG_2`
  - согласован `18-worker`
- Что нужно сделать:
  - реализовать `imports/preview`, `imports/commit`, `GET import job`;
  - построить preview и commit на одной нормализованной модели;
  - вычислять `create/update/skip/manual_review` для строк;
  - сделать commit идемпотентным по `idempotency_key`;
  - учесть SKU soft-deleted товара по той же policy, что и ручной create.
- Критерий закрытия:
  - import preview и commit предсказуемо совпадают по решениям;
  - повторный commit не создает дубли;
  - import errors и статистика читаемы и пригодны для UX.

**Что сделано**

Реализован двухфазный import pipeline для каталога товаров. Все файлы созданы без изменения схемы БД (таблицы `CatalogImportJob` и `CatalogImportJobItem` уже существовали после TASK_CATALOG_1).

### Новые файлы

**`apps/api/src/modules/catalog/dto/import-preview.dto.ts`**
- `ImportRowDto` — строка импорта: обязательные `sku` и `name`, опциональные `brand`, `barcode`, `category`.
- `ImportPreviewDto` — массив строк `rows` с вложенной валидацией через `@ValidateNested`.

**`apps/api/src/modules/catalog/dto/import-commit.dto.ts`**
- `ImportCommitDto` — `jobId` (UUID) + опциональный `idempotencyKey` (строка).

**`apps/api/src/modules/catalog/import.service.ts`**
- `preview(dto, tenantId, userId)` — создаёт `CatalogImportJob(status=PREVIEW)`, батч-запрашивает все SKU из базы, для каждой строки вычисляет `action: CREATE | UPDATE | MANUAL_REVIEW` (SKIP не производится на preview — остаётся для явной метки в будущем). Soft-deleted SKU → `MANUAL_REVIEW` с описательным сообщением. Возвращает `jobId + summary + items`.
- `commit(dto, tenantId, userId)` — идемпотентен по `idempotencyKey`: если в tenant уже есть `COMPLETED`-job с таким ключом, возвращает его без повторной обработки. Если тот же `jobId` уже `COMPLETED` — тоже возвращает без повторного применения. Переводит job в `PROCESSING`, обрабатывает items: CREATE с проверкой актуального состояния SKU (мог стать активным за время между preview и commit), UPDATE с аналогичной защитой, MANUAL_REVIEW — считается в `errorCount`. Завершает job в `COMPLETED` со статистикой.
- `getJob(jobId, tenantId)` — возвращает job со всеми items.

**`apps/api/src/modules/catalog/import.controller.ts`**
- `POST /api/catalog/imports/preview` — `@UseGuards(TenantWriteGuard)`, HTTP 200.
- `POST /api/catalog/imports/commit` — `@UseGuards(TenantWriteGuard)`, HTTP 200.
- `GET /api/catalog/imports/:jobId` — только RequireActiveTenantGuard (read-only).

### Изменённые файлы

**`apps/api/src/modules/catalog/product.module.ts`**
- Добавлены `ImportService` в `providers` и `ImportController` в `controllers`.

### Ключевые свойства реализации

- **Idempotency**: защита на двух уровнях — по `idempotencyKey` (cross-job) и по `jobId` (single-job повтор).
- **Нормализованная модель**: preview и commit работают на одних и тех же `CatalogImportJobItem` строках — решения не расходятся.
- **Soft-deleted SKU policy**: preview помечает такие строки как `MANUAL_REVIEW`, commit пропускает их — та же политика, что в ручном создании (`confirmRestoreId` требуется явно).
- **Race-condition защита**: commit повторно проверяет актуальность SKU в БД на момент применения (состояние могло измениться между preview и commit).
- **TenantWriteGuard**: write-эндпоинты защищены от операций при `TRIAL_EXPIRED / SUSPENDED / CLOSED`.
