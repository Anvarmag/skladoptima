# Логика синхронизации — Sklad Optima

> **Файл:** `apps/api/src/sync/sync.service.ts` (~700 строк кода)  
> **Роль:** Самый сложный и важный модуль проекта. Отвечает за двустороннюю синхронизацию остатков и заказов между БД Sklad Optima и маркетплейсами (WB, Ozon).

---

## Архитектура процесса (Background Polling)

В методе `onModuleInit()` запускается setInterval: **каждые 60 секунд** выполняется полный цикл:

```typescript
setInterval(() => {
    // 1. Стянуть остатки FBS с WB
    this.pullFromWb();

    // 2. Уменьшить остатки из-за новых заказов WB
    this.processWbOrders();

    // 3. Обновить фото и названия карточек товаров
    this.syncProductMetadata();

    // 4. Стянуть остатки (FBS+FBO) с Ozon
    this.pullFromOzon();

    // 5. Уменьшить остатки из-за новых заказов FBS Ozon
    this.processOzonOrders();
}, 60000); // 1 минута
```

---

## 1. Pull с Wildberries (`pullFromWb`)

Стягивает текущие остатки продавца со склада WB (FBS).

1. `GET https://suppliers-api.wildberries.ru/api/v3/stocks/{wbWarehouseId}`
2. Для каждого полученного товара (`wbBarcode` -> `Product`):
   - Если в БД `wbFbs !== wbStock` (появилась дельта на стороне WB, например, кто-то руками поменял остаток в ЛК WB):
     - `delta = wbStock - wbFbs`
     - Новый `total = Math.max(0, product.total + delta)`
     - Сохраняет новый `wbFbs` и `total` в БД.
     - Пишет в AuditLog: действие `STOCK_ADJUSTED`, актер `system-wb`, дельта `delta`.
3. **Реконсиляция:** если у товара в нашей БД "целевой" остаток, который должен быть на WB, отличается от реального на WB, отправляет push-запрос на WB.
4. **Push на Ozon:** если `total` изменился (появилась дельта с WB), вызывает push нового `total` на Ozon (`pushStockOzon`).

---

## 2. Pull с Ozon (`pullFromOzon`)

Стягивает текущие остатки со складов Ozon (FBO и FBS).

1. `POST https://api-seller.ozon.ru/v1/product/info/stocks-by-warehouse/fbs`
2. `POST https://api-seller.ozon.ru/v2/product/info/stocks` (FBO/FBS)
3. Для каждого товара (`sku` -> `Product`):
   - Если FBS остаток изменился на стороне Ozon:
     - Рассчитывает `delta = ozonStock - product.ozonFbs`
     - Меняет `total = Math.max(0, product.total + delta)`
     - Сохраняет новые Ozon кэши (`ozonFbs`, `ozonFbo`) и новый `total`.
     - Изменение логгируется: актер `system-ozon`.
   - Если `total` изменился, вызывает push нового остатка на WB (`pushStockWb`).

> **FBO (со складов МП):** Ozon FBO остатки пуллятся и сохраняются в `Product.ozonFbo` только для отображения в таблице "Остатки (Наш / WB FBS-FBO / Ozon FBS-FBO)". Наша система **не списывает `total`** по заказам FBO, потому что маркетплейс сам их отгружает. Списываются только FBS. WB FBO данные пока не тянутся (WB Statistics API).

---

## 3. Обработка заказов (Process Orders)

### Wildberries (`processWbOrders`)
1. Запрашивает заказы за последние 7 дней со статусом `0` (новые заказы).
2. Для каждого заказа:
   - Проверяет `MarketplaceOrder` по `id` (чтобы не списать дважды).
   - Если заказа в БД нет: списывает `total = Math.max(0, total - orderQuantity)`, сохраняет в `MarketplaceOrder`.
   - Пишет лог `ORDER_DEDUCTED` от `system-wb`.
   - **Автоматически пушит новый (уменьшенный) `total` на Ozon** = чтобы не было оверселла.

### Ozon (`processOzonOrders`)
1. `POST https://api-seller.ozon.ru/v3/posting/fbs/list` (статусы `awaiting_packaging`, `awaiting_deliver`, `delivering`).
2. Для каждого отправления:
   - Дедубликация по `posting_number`.
   - Списание `total`, запись лога от `system-ozon`.
   - **Пуш нового `total` на WB**.

---

## 4. Push остатков на Маркетплейсы

Выполняется из:
- Обработки заказов (после списания мы пушим новый остаток конкуренту).
- Ручной корректировки (кнопка сохранения остатков).
- Ручной кнопки "Синхронизировать".

### Ping-Pong Prevention 🏓🚨

Если мы запушили остаток на WB (например 10 штук), то через минуту наш `pullFromWb()` скачает эти 10 штук. Из-за асинхронности или лагов API, WB может вернуть нам старое значение (например 12), и система подумает: "Ого, на WB 12, значит дельта +2, надо добавить к нашему `total`!". И так - до бесконечности.

**Решение (cooldown):**
- У `SyncService` есть `private syncCooldowns: Map<string, number> = new Map();`
- При пуше на МП для товара ставится кулдаун `syncCooldowns.set(productId, Date.now() + 120_000)` (на 2 минуты).
- Модули `pullFromWb` и `pullFromOzon` пропускают товары, находящиеся в кулдауне.

### `syncProductToMarketplaces(productId)`
Основная функция ручной синхронизации.
1. Берёт свежий `total - reserved` = `available`.
2. Ставит кулдаун 2 мин.
3. Отправляет `available` на WB (`PUT v3/stocks`). Сохраняет `wbFbs = available` в БД.
4. Отправляет `available` на Ozon (`POST v2/products/stocks`). Сохраняет `ozonFbs = available` в БД.
5. Возвращает `{ wb: { success: true }, ozon: { ... }, amount: N }`.

---

## 5. Обновление Metadata

Раз в минуту `syncProductMetadata()` собирает все артикулы, у которых нет поля `photo` или поле `name` подозрительное ("SKU-%").
Запрашивает:
- WB API `POST /content/v2/get/cards/list` по nmIDs.
- Ozon API `POST /v2/product/info/list` по skus.
И обновляет в базе названия и ссылки на фото. Благодаря этому после импорта Excel таблицы через минуту прогружаются все фотографии.
