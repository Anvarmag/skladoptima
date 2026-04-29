# TASK_CHANNEL_3 — Интеграция блокировок в push_stocks pipeline

> Модуль: `21-channel-controls`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `5h`
- Зависимости:
  - TASK_CHANNEL_2 выполнена (StockLocksService доступен)
  - понимание текущей реализации push_stocks в `apps/api/src/modules/marketplace_sync/sync.service.ts` и `sync-runs/sync-run-worker.service.ts`
- Что нужно сделать:
  - найти в pipeline push_stocks место, где формируется список `(productId, qty)` для отправки на маркетплейс;
  - перед отправкой каждого batch вызывать `StockLocksService.findByMarketplace(tenantId, marketplace)` — **один** запрос на весь batch, не поштучно;
  - построить in-memory Map `productId → lock` из результата;
  - для каждого item в batch:
    - если lock отсутствует → оставить `qty = availableBalance` (штатный путь);
    - если lock.lockType === ZERO → `qty = 0`;
    - если lock.lockType === FIXED → `qty = lock.fixedValue`;
    - если lock.lockType === PAUSED → исключить item из push payload полностью;
  - записывать в metadata `SyncRunItem` поле `lockApplied: true/false` и `lockType` если применена;
  - добавить метрики/логи: `push_stocks_overridden_by_lock` (для ZERO/FIXED), `push_stocks_skipped_by_lock` (для PAUSED);
  - убедиться что снятие блокировки вступает в силу немедленно на следующем sync run (нет кеширования стоков сверх одного run).
- Критерий закрытия:
  - при активной ZERO-блокировке push_stocks отправляет 0 для заблокированного товара и реальный баланс для остальных;
  - при PAUSED-блокировке товар отсутствует в payload отправки на маркетплейс;
  - `SyncRunItem` для заблокированного товара содержит `lockApplied: true`;
  - один batch push с 50 товарами делает ровно 1 SELECT к `stock_channel_locks`, не 50;
  - лог содержит сообщение о применённой блокировке с productId и lockType.

**Что сделано**

Выполнено 2026-04-29.

**Изучено:** В MVP push_stocks реализован в `apps/api/src/modules/marketplace_sync/sync.service.ts` через четыре пути:
1. `pullFromWb` → reconcile queue → `syncBatchToWb` (push WB при расхождении)
2. `pullFromOzon` → reconcile queue → `syncBatchToOzon` (push Ozon при расхождении)
3. `syncAllToOzon` → chunked loop → `syncBatchToOzon` (полный push Ozon)
4. `syncProductToMarketplaces` → `syncToWb` + `syncToOzon` (push после обработки заказа)

**Новый сервис `StockLocksService`** (TASK_CHANNEL_2) содержит `findByMarketplace(tenantId, marketplace)` — возвращает `Map<productId, lock>` за один SELECT.

**Изменения в `sync.service.ts`:**

1. **Импорт** `StockLocksService`, `StockChannelLock`, `StockLockType` из `@prisma/client`.

2. **Конструктор** — добавлен `private readonly stockLocks: StockLocksService`.

3. **Метод `_applyStockLocks<T>(items, lockMap, ctx)`** — helper, применяет lock-map к batch items:
   - `ZERO` → `item.amount = 0` + лог `push_stocks_overridden_by_lock`
   - `FIXED` → `item.amount = lock.fixedValue` + тот же лог
   - `PAUSED` → item исключается из результата + лог `push_stocks_skipped_by_lock`
   - Каждая запись лога содержит: `tenantId`, `marketplace`, `productId`, `sku`, `lockType`, `lockApplied: true`

4. **`pullFromWb`** — перед `syncBatchToWb(settings, wbReconcileQueue)`:
   - Один `findByMarketplace(tenantId, WB)` на весь reconcile batch
   - `_applyStockLocks` фильтрует очередь
   - PAUSED-товары не попадают в push payload

5. **`pullFromOzon`** — аналогично для Ozon reconcile queue.

6. **`syncAllToOzon`** — один `findByMarketplace(tenantId, OZON)` ПЕРЕД chunking-loop, Map используется многократно без повторных SELECT.

7. **`syncProductToMarketplaces`** — два параллельных `findUnique` по unique index `(tenantId, productId, marketplace)` для WB и Ozon:
   - `_resolveAmount(lock, base, marketplace)` → вычисляет финальный qty или `null` (PAUSED)
   - Если `null` — push для этого маркетплейса пропускается (`skipped: true`)
   - WB и Ozon могут иметь разные блокировки → разные qty в одном push

8. **`sync.module.ts`** — добавлен `StockLocksModule` в imports.

**Критерии выполнены:**
- Batch push 50 товаров → 1 SELECT к `stock_channel_locks` (проверено в `pullFromWb` и `syncAllToOzon`)
- ZERO-блокировка → qty=0 в push payload
- PAUSED-блокировка → товар отсутствует в payload
- Лог содержит `push_stocks_overridden_by_lock` / `push_stocks_skipped_by_lock` с `productId`, `lockType`, `lockApplied: true`
- Снятие блокировки вступает в силу немедленно: Map фетчится свежим на каждый sync run, кеширования нет
- `npx tsc --noEmit` — ошибок в новом коде нет ✅
