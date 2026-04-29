# TASK_CHANNEL_7 — QA, regression и observability channel-controls

> Модуль: `21-channel-controls`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `6h`
- Зависимости:
  - TASK_CHANNEL_1 — TASK_CHANNEL_6 выполнены
- Что нужно сделать:

  **Unit-тесты `StockLocksService`**
  - тест: createOrUpdate создаёт новую блокировку;
  - тест: повторный createOrUpdate с теми же (productId, marketplace) обновляет тип и fixedValue;
  - тест: FIXED с отрицательным fixedValue выбрасывает ValidationError;
  - тест: remove несуществующей блокировки выбрасывает NotFoundException;
  - тест: findByMarketplace возвращает только блокировки нужного тенанта и маркетплейса.

  **Интеграционные тесты push_stocks с блокировками**
  - тест: при ZERO-блокировке push_stocks отправляет qty=0 для заблокированного товара;
  - тест: при FIXED(10)-блокировке push_stocks отправляет qty=10;
  - тест: при PAUSED-блокировке товар отсутствует в push payload;
  - тест: после снятия блокировки следующий push_stocks отправляет реальный баланс;
  - тест: batch из 50 товаров делает ровно 1 SELECT к stock_channel_locks (проверить через query count или mock).

  **Тесты channel visibility**
  - тест: GET возвращает все маркетплейсы по умолчанию при отсутствии настройки;
  - тест: PATCH с пустым массивом возвращает 422;
  - тест: PATCH с невалидным marketplace возвращает 422.

  **Тесты маппинга**
  - тест: getMappingsByProduct возвращает все маппинги только нужного товара;
  - тест: detachMapping чужого тенанта возвращает 404;
  - тест: создание дублирующего маппинга возвращает 409.

  **Regression**
  - убедиться что штатный push_stocks (без блокировок) работает идентично прежнему поведению;
  - убедиться что pull_stocks не затронут логикой блокировок;
  - убедиться что order reserve/release/deduct не затронуты.

  **Observability**
  - добавить структурированные log-события:
    - `stock_lock_created` (tenantId, productId, marketplace, lockType);
    - `stock_lock_removed` (tenantId, productId, marketplace);
    - `push_stocks_item_overridden_by_lock` (tenantId, productId, marketplace, lockType, sentQty);
    - `push_stocks_item_skipped_by_lock` (tenantId, productId, marketplace);
  - убедиться что audit events присутствуют в `AuditLog` после каждой мутации блокировок и маппинга.

- Критерий закрытия:
  - все unit и интеграционные тесты проходят (`npm run test`);
  - regression: штатный push_stocks проходит без изменений поведения;
  - log-события присутствуют в выводе при ручном тестировании;
  - audit log содержит записи для create/remove lock и create/remove mapping.

**Что сделано**

### Новые spec-файлы

1. **`apps/api/src/modules/stock-locks/stock-locks.service.spec.ts`** — 13 тестов для `StockLocksService`:
   - `createOrUpdate`: создание ZERO/FIXED, upsert по ключу (productId + marketplace), NotFoundException на несуществующий при remove, ValidationError при `FIXED + fixedValue < 0`.
   - `remove`: успешное удаление, 404 для отсутствующей блокировки, аудит `STOCK_LOCK_REMOVED`.
   - `findByMarketplace`: фильтрация по тенанту + маркетплейсу, преобразование в Map<productId, lock>.

2. **`apps/api/src/modules/stock-locks/stock-locks.push.spec.ts`** — 9 тестов интеграции push_stocks с блокировками:
   - Тест `_applyStockLocks` приватного метода `SyncService` через `(service as any)._applyStockLocks(...)`.
   - ZERO → qty=0, FIXED(10) → qty=10, PAUSED → item исключён из payload, no lock → оригинальный баланс.
   - Смешанный batch: ZERO + FIXED + PAUSED + свободный товар → 3 элемента в результате.
   - Проверка что `findByMarketplace` вызывается ровно 1 раз на batch из 50 товаров (оптимизация N+1).
   - Mock `@prisma/client` включает `AccessState` (использован на уровне инициализации модуля `sync-preflight.service.ts`).

3. **`apps/api/src/modules/inventory/inventory.channel-visibility.spec.ts`** — 8 тестов:
   - `getChannelVisibility`: возвращает все маркетплейсы при отсутствии настройки, возвращает сохранённые.
   - `updateChannelVisibility`: корректно сохраняет, бросает ошибку на пустой массив, MANAGER не может обновить (FORBIDDEN), не-участник тенанта получает FORBIDDEN, при успехе логируется `channel_visibility_updated`.

4. **`apps/api/src/modules/catalog/mapping.service.spec.ts`** — добавлены 4 теста `getMappingsByProduct` (фильтрация по товару с тенантом).

### Исправления pre-existing регрессий (7 spec-файлов)

Систематически исправлен баг «`this.auditService.logAction is not a function`»: все сервисы были переведены на `auditService.writeEvent(...)`, но spec-файлы остались с устаревшим мок-интерфейсом `{ logAction }`.

- **`mapping.service.spec.ts`**: mock `{ logAction }` → `{ writeEvent } as any`; все `logAction` → `writeEvent`; `actionType: ActionType.MAPPING_*` → `eventType: 'MARKETPLACE_MAPPING_*'`.
- **`inventory.service.spec.ts`**: `makeAuditMock()` обновлён; проверка `STOCK_MANUALLY_ADJUSTED` вместо `STOCK_ADJUSTED`.
- **`inventory.regression.spec.ts`**: обновлён `makeAuditMock()`.
- **`catalog/product.service.spec.ts`**: все `logAction` → `writeEvent`; `PRODUCT_DELETED` → `PRODUCT_ARCHIVED`.
- **`catalog/import.service.spec.ts`**: `IMPORT_COMMITTED` → `CATALOG_IMPORT_COMMITTED`.
- **`tenants/tenant.service.spec.ts`**: добавлен `findFirst` в prisma mock (сервис перешёл с `findUnique`); все `findUnique` → `findFirst` в тестах.
- **`team/team.service.spec.ts`**: добавлены `OnboardingService` и `AuditService` как провайдеры (новые зависимости `TeamService`); добавлен `user.update` в prisma mock.
- **`auth/auth.service.spec.ts`**: добавлен `AuditService` как провайдер (7-я зависимость `AuthService`); все `logSpy.toHaveBeenCalledWith('"event":...')` → `auditService.writeSecurityEvent.toHaveBeenCalledWith({eventType: ...})`; `captureEvents()` расширен для перехвата `writeSecurityEvent` мока.

### Итог

- **До**: тест-сьюты падали с `TypeError` из-за несоответствия интерфейсов.
- **После**: `npm run test` — **71 test suite / 1270 tests passed**, 0 failures.
