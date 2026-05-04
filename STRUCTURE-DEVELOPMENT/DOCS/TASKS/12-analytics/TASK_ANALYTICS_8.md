# TASK_ANALYTICS_8 — Подтягивание реальных финансов WB через Статистика API

> Модуль: `12-analytics` + `11-finance`
> Статус: [x] Выполнен
> Приоритет: `P2`
> Оценка: `10h`
> Зависимости: `TASK_MARKETPLACE_ACCOUNTS_8` (нужен `analyticsToken`)

---

## Контекст

Сейчас юнит-экономика считает прибыль по формуле:
```
revenue (из order.price) − себестоимость − marketplaceFees (вводится вручную!) − логистика
```

Поле `marketplaceFees` заполнялось вручную через cost profile. Если пользователь его не указал — система выдавала предупреждение `MISSING_FEES` и помечала расчёт как `incomplete`.

WB предоставляет реальные данные через `statistics-api.wildberries.ru`:
- Фактическая комиссия по каждому заказу/реализации
- Логистика (что WB списал за доставку)
- Хранение на складах WB
- Штрафы и доплаты

После выполнения этой задачи `marketplaceFees` заполняется **автоматически** из реального финансового отчёта WB, и юнит-экономика становится точной без ручного ввода.

## Эндпоинты WB (категория Статистика, только чтение)

| Эндпоинт | Что даёт |
|----------|----------|
| `GET /api/v5/supplier/reportDetailByPeriod` | Детализированный отчёт реализации (комиссия, логистика, хранение по каждой позиции) |
| `GET /api/v1/supplier/sales` | Продажи по дням |
| `GET /api/v1/supplier/stocks` | FBO остатки (уже используется) |

## Что сделано

### Новый sync-тип `PULL_FINANCES_WB`
- [x] Добавлен в `SyncTypes` в `sync-run.contract.ts`
- [x] Реализован `pullWbFinances(tenantId, days = 30)` в `sync.service.ts`:
  - Вызывает `/api/v5/supplier/reportDetailByPeriod` через `analyticsToken` (scope `analytics` в `getWbHeaders`)
  - Поддерживает pagination через `rrdid` курсор (до 1000 строк на страницу)
  - Без `analyticsToken` → ранний возврат с кодом `ANALYTICS_TOKEN_MISSING`
  - 401/403 от WB → код `ANALYTICS_TOKEN_INVALID`
  - Маппинг полей: `rrd_id` → `realizationId`, `sa_name` → `sku`, `gi_id` → `orderId`,
    `ppvz_sales_commission` → `commissionRub`, `delivery_rub` → `deliveryRub`,
    `storage_fee` → `storageFee`, `deduction` → `penalty`
  - Upsert по `UNIQUE(tenantId, realizationId)` — идемпотентен
- [x] Добавлен REST endpoint `POST /api/sync/pull/wb-finances?days=30` в `sync.controller.ts`

### Prisma schema
- [x] Добавлена модель `WbFinanceReport` в `schema.prisma`:
  - `realizationId BigInt` + `@@unique([tenantId, realizationId])` — deduplication
  - `sku VARCHAR(128)` — ссылка на наш vendorCode
  - `commissionRub`, `deliveryRub`, `storageFee`, `penalty` — финансовые поля
  - `periodFrom`, `periodTo` — период отчёта
  - `rawPayload Json` — сырой ответ WB для диагностики
  - Индексы: `(tenantId, sku)` для loader, `(tenantId, periodFrom, periodTo)` для range-запросов
  - FK на `Tenant` и `MarketplaceAccount` с `onDelete: Cascade`
- [x] Создана миграция `20260503000000_wb_finance_report`
- [x] Добавлены relations `wbFinanceReports WbFinanceReport[]` в `Tenant` и `MarketplaceAccount`

### Обогащение юнит-экономики
- [x] В `finance-snapshot.service.ts` метод `_loadInputs` обновлён:
  - Сначала запрашивает `WbFinanceReport` за период, группирует по `sku`
  - Если WB данные есть по SKU → `marketplaceFees = sum(commissionRub)`,
    `logistics = sum(deliveryRub + storageFee)` — точные per-SKU значения
  - Если нет → fallback на пропорциональное распределение из `MarketplaceReport`
  - Логирует `finance_loader_wb_report_used` с количеством покрытых SKU

### Frontend
- [x] В `SyncRuns.tsx` добавлен `PULL_FINANCES_WB` в:
  - `SYNC_TYPE_LABEL` → `'Финансы WB (комиссия, логистика)'`
  - `AVAILABLE_TYPES` в `CreateRunModal` — можно запустить вручную

## Критерий готовности

- [x] `PULL_FINANCES_WB` запускается вручную через UI (раздел «Синхронизация» → «Запустить sync»)
- [x] `marketplaceFees` в юнит-экономике берётся из `WbFinanceReport` для WB-заказов (когда данные есть)
- [x] Юнит-экономика не показывает `MISSING_FEES` для SKU с данными из WB финотчёта
- [x] `analyticsToken` используется для запроса (не `apiToken`) через `getWbHeaders(settings, 'analytics')`
- [x] Без `analyticsToken` — задача не запускается и возвращает понятную ошибку (`ANALYTICS_TOKEN_MISSING`)

## Что осталось (future scope)
- [ ] Планировщик: запускать `PULL_FINANCES_WB` автоматически (еженедельно) вместе с `PULL_STOCKS`
- [ ] Убрать предупреждение `MISSING_FEES` в UI для WB-позиций когда есть данные (сейчас убирается автоматически, т.к. `marketplaceFees != null`)

## История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-05-03 | Задача создана | Анвар |
| 2026-05-03 | Задача выполнена: WbFinanceReport модель, миграция, pullWbFinances(), finance-snapshot интеграция, frontend | Claude |
