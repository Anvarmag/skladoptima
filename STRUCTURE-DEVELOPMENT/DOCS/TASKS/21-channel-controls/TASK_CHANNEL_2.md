# TASK_CHANNEL_2 — Backend API блокировок: CRUD StockChannelLock

> Модуль: `21-channel-controls`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `6h`
- Зависимости:
  - TASK_CHANNEL_1 выполнена (модель `StockChannelLock` в БД)
  - `16-audit` модуль подключён
- Что нужно сделать:
  - создать NestJS-модуль `StockLocksModule` в `apps/api/src/modules/stock-locks/`;
  - реализовать `StockLocksService` с методами:
    - `createOrUpdate(tenantId, dto)` — upsert по `(tenantId, productId, marketplace)`;
    - `remove(tenantId, lockId)` — удалить блокировку;
    - `removeByKey(tenantId, productId, marketplace)` — удалить по составному ключу;
    - `list(tenantId, filters?)` — список блокировок тенанта с фильтрами по `productId`, `marketplace`;
    - `findByMarketplace(tenantId, marketplace)` — batch-lookup для push_stocks pipeline;
  - реализовать `StockLocksController` с эндпоинтами (см. system-analytics §6);
  - реализовать DTO: `CreateStockLockDto` (productId, marketplace, lockType, fixedValue?, note?), `ListStockLocksQuery`;
  - добавить валидацию: FIXED требует `fixedValue >= 0`; productId должен принадлежать тенанту;
  - добавить guard: marketplace аккаунт должен быть активен для тенанта;
  - emit audit события `STOCK_LOCK_CREATED` и `STOCK_LOCK_REMOVED` через `AuditService`;
  - добавить событие-константы в `audit-event-catalog.ts`;
  - зарегистрировать модуль в `app.module.ts`.
- Критерий закрытия:
  - `POST /api/v1/stock-locks` создаёт блокировку и возвращает её с id;
  - повторный POST с теми же `(productId, marketplace)` обновляет тип и значение (upsert);
  - `DELETE /api/v1/stock-locks/:lockId` удаляет блокировку;
  - `GET /api/v1/stock-locks?productId=X` возвращает только блокировки для товара X;
  - audit события присутствуют в `AuditLog` после каждой мутации;
  - попытка создать FIXED с `fixedValue: -1` возвращает 400.

**Что сделано**

Выполнено 2026-04-29.

**Созданы файлы:**

1. `apps/api/src/modules/stock-locks/dto/create-stock-lock.dto.ts`
   - Поля: `productId`, `marketplace` (enum MarketplaceType), `lockType` (enum StockLockType), `fixedValue?` (Int, @Min(0), только при FIXED через `@ValidateIf`), `note?` (@MaxLength(500)).
   - Валидация FIXED требует `fixedValue >= 0` на уровне DTO.

2. `apps/api/src/modules/stock-locks/dto/list-stock-locks.query.ts`
   - Поля: `productId?`, `marketplace?`, `page?`, `limit?` (с трансформацией через `@Type(() => Number)`).

3. `apps/api/src/modules/stock-locks/stock-locks.service.ts`
   - `createOrUpdate(tenantId, actorId, dto)` — upsert по `(tenantId, productId, marketplace)`; проверяет существование product в тенанте и активность marketplace аккаунта (`lifecycleStatus = ACTIVE`); для FIXED проверяет fixedValue; после upsert эмитит `STOCK_LOCK_CREATED`.
   - `remove(tenantId, lockId, actorId)` — удаляет блокировку по id; эмитит `STOCK_LOCK_REMOVED`.
   - `removeByKey(tenantId, productId, marketplace, actorId)` — удаляет по составному ключу через `findUnique` + `remove`.
   - `list(tenantId, query)` — пагинированный список с фильтрами по `productId`, `marketplace`; include product (id, sku, name).
   - `findByMarketplace(tenantId, marketplace)` — batch-lookup для push_stocks pipeline: один SELECT, возвращает `Map<productId, lock>`.

4. `apps/api/src/modules/stock-locks/stock-locks.controller.ts`
   - `@UseGuards(RequireActiveTenantGuard)` на весь контроллер.
   - `GET /stock-locks` — list (доступен Owner/Admin/Manager).
   - `POST /stock-locks` — createOrUpdate (TenantWriteGuard, 201).
   - `DELETE /stock-locks/:lockId` — remove по id (TenantWriteGuard, 204).
   - `DELETE /stock-locks?productId=&marketplace=` — remove по ключу (TenantWriteGuard, 204).

5. `apps/api/src/modules/stock-locks/stock-locks.module.ts`
   - imports: AuditModule; exports: StockLocksService (для use в sync pipeline).

**Обновлены:**

6. `apps/api/src/modules/audit/audit-event-catalog.ts`
   - Добавлен домен `CHANNEL_CONTROLS`.
   - Добавлены события `STOCK_LOCK_CREATED`, `STOCK_LOCK_REMOVED` и их маппинг в `EVENT_DOMAIN_MAP`.

7. `apps/api/src/modules/audit/audit-coverage.contract.ts`
   - Добавлен контракт `channel_controls` с mandatory events: `STOCK_LOCK_CREATED`, `STOCK_LOCK_REMOVED`.

8. `apps/api/src/app.module.ts`
   - Зарегистрирован `StockLocksModule`.

**Проверка:** `npx tsc --noEmit` — ошибок в новом модуле нет. `npx prisma generate` выполнен, `StockLockType` и `stockChannelLock` доступны из `@prisma/client`.
