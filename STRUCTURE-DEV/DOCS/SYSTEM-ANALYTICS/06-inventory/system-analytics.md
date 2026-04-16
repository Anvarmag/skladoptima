# Остатки (Inventory) — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль управляет master/FBS-остатком, резервами под заказы, ручными корректировками, историей движений и каналными lock/override правилами.

## 2. Функциональный контур и границы

### Что входит в модуль
- хранение балансов, резервов и доступного остатка;
- ручные корректировки и системные stock movements;
- разрезы по складам, fulfillment mode и каналам;
- защита от отрицательных остатков по политике MVP;
- подготовка данных для push stocks и order side-effects.

### Что не входит в модуль
- справочник складов как внешний reference layer;
- ingestion заказов и внешних событий как самостоятельный домен;
- финансовая оценка stock value;
- физическая WMS/ячеистое хранение и инвентаризация уровня enterprise.

### Главный результат работы модуля
- система в любой момент может ответить, сколько товара реально доступно к продаже и какие события изменили этот баланс.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin/Manager | Смотрит и корректирует stock по правилам | Manual adjust только при наличии прав |
| Orders module | Создает reserve/release/deduct side-effects | Не должен писать в balance произвольными update |
| Sync module | Подтягивает внешние остатки и инициирует reconciliation | Не должен терять source tracing |
| Marketplace push | Использует available stock как источник | Только после бизнес-правил inventory |

## 4. Базовые сценарии использования

### Сценарий 1. Ручная корректировка
1. Пользователь выбирает товар и склад.
2. Указывает delta или target quantity.
3. Backend валидирует права и допустимость операции.
4. Создается stock movement и обновляется агрегированный баланс.
5. Изменение доступно для последующего push/sync.

### Сценарий 2. Резерв по новому заказу
1. Orders module публикует событие `order_reserved`.
2. Inventory service определяет product, warehouse scope и mode.
3. Создается reserve movement.
4. `reserved` увеличивается, `available` уменьшается.

### Сценарий 3. Отмена или выполнение заказа
1. Заказ переходит в cancel/fulfilled state.
2. Inventory service получает событие.
3. Для cancel выполняется release reserve, для fulfill — deduct from on_hand.
4. История движения остается воспроизводимой для расследования.

## 5. Зависимости и интеграции

- Catalog (товары/SKU)
- Orders (reserve/release/deduct)
- Sync (push в каналы)
- Notifications (low stock)
- Audit

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/inventory/stocks` | User | Список остатков по товарам |
| `GET` | `/api/v1/inventory/stocks/:productId` | User | Детализация по складам/каналам |
| `POST` | `/api/v1/inventory/adjustments` | Owner/Admin/Manager | Ручная корректировка |
| `GET` | `/api/v1/inventory/movements` | User | История движений |
| `POST` | `/api/v1/inventory/channel-overrides` | Owner/Admin/Manager | Включить lock/override |
| `DELETE` | `/api/v1/inventory/channel-overrides/:id` | Owner/Admin/Manager | Отключить lock/override |
| `GET` | `/api/v1/inventory/low-stock` | User | SKU ниже порога |
| `PATCH` | `/api/v1/inventory/settings/threshold` | Owner/Admin | Глобальный low-stock порог |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/inventory/adjustments \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"productId":"prd_...","warehouseId":"wh_...","delta":-3,"reason":"LOSS","comment":"Недостача"}'
```

```json
{
  "movementId": "mov_...",
  "onHandBefore": 25,
  "onHandAfter": 22,
  "availableAfter": 18
}
```

## 8. Модель данных (PostgreSQL)

### `stock_balances`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID`, `warehouse_id UUID`
- `on_hand INT NOT NULL DEFAULT 0`
- `reserved INT NOT NULL DEFAULT 0`
- `available INT GENERATED ALWAYS AS (on_hand - reserved) STORED`
- `updated_at`
- `UNIQUE(tenant_id, product_id, warehouse_id)`

### `stock_movements`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID`, `warehouse_id UUID NULL`
- `movement_type ENUM(manual_add, manual_remove, order_reserved, order_released, order_deducted, inventory_adjustment, return_logged, conflict_detected)`
- `delta INT NOT NULL`
- `on_hand_before INT`, `on_hand_after INT`
- `reserved_before INT`, `reserved_after INT`
- `reason_code VARCHAR(64) NULL`, `comment TEXT NULL`
- `source ENUM(user, system, marketplace)`
- `actor_user_id UUID NULL`, `created_at`

### `channel_stock_overrides`
- `id UUID PK`, `tenant_id UUID`, `product_id UUID`, `marketplace_account_id UUID`
- `is_locked BOOLEAN NOT NULL DEFAULT true`
- `override_qty INT NOT NULL`
- `created_by UUID`, `created_at`, `updated_at`
- `UNIQUE(tenant_id, product_id, marketplace_account_id)`

### `inventory_settings`
- `tenant_id UUID PK`, `low_stock_threshold INT NOT NULL DEFAULT 5`

## 9. Сценарии и алгоритмы (step-by-step)

1. Ручная корректировка: транзакция `SELECT ... FOR UPDATE` по `stock_balances`, запрет отрицательного `on_hand`.
2. При order reserve: `reserved + qty`, `available` уменьшается.
3. При order cancel: `reserved - qty`, `available` восстанавливается.
4. При order fulfilled: `reserved - qty`, `on_hand - qty`.
5. Возврат: создается movement `return_logged`, автоплюс в `on_hand` не делаем.
6. Если есть `channel_stock_override`, push в конкретный канал берет `override_qty`.

## 10. Валидации и ошибки

- `delta != 0`, `reason` обязателен для manual корректировки.
- Нельзя уйти в отрицательный `on_hand`.
- Ошибки:
  - `CONFLICT: NEGATIVE_STOCK_NOT_ALLOWED`
  - `NOT_FOUND: STOCK_BALANCE_NOT_FOUND`
  - `FORBIDDEN: STOCK_ADJUST_NOT_ALLOWED`

## 11. Чеклист реализации

- [ ] Миграции stock-модели.
- [ ] Транзакционные сервисы reserve/release/deduct.
- [ ] API для adjustments/history/overrides.
- [ ] Конфликт-детектор устаревших внешних событий.
- [ ] Low-stock правила + интеграция с notifications.

## 12. Критерии готовности (DoD)

- Движения остатков полностью трассируемы.
- Отрицательные остатки невозможны.
- Channel lock/override работает per SKU+account.

## 13. Транзакционные правила

- Любая операция над остатком выполняется в БД-транзакции.
- Для строки `stock_balances` используется блокировка `FOR UPDATE`.
- Источник истины для расчета: `on_hand`, `reserved`; `available` вычисляется, а не хранится вручную бизнес-логикой.
- История движения (`stock_movements`) пишется в той же транзакции, что и изменение остатка.

## 14. Модель складского учета на MVP

### Что считается управляемым контуром
- только `FBS`

### Что считается внешним информационным контуром
- `FBO`

### Как хранить FBO
- либо отдельным read-model слоем
- либо отдельными `stock_balances` с признаком `is_external=true`
- но никогда не смешивать FBO с мастер-остатком для push

## 15. Контракты с orders и sync

### Orders -> Inventory
- `reserve(order_id, items[])`
- `release(order_id, items[])`
- `deduct(order_id, items[])`

### Inventory -> Sync
- после успешной ручной корректировки
- после финального изменения `available`
- при изменении override/lock

### Что передавать в sync
- `product_id`
- `marketplace_account_id`
- `effective_available_qty`
- `reason`
- `source_event_id`

## 16. Тестовая матрица

- Ручное увеличение остатка.
- Ручное уменьшение остатка до нуля.
- Попытка уменьшить ниже нуля.
- Reserve двух заказов подряд.
- Cancel после reserve.
- Fulfill после reserve.
- Override для одного marketplace account.
- Конфликт ручной корректировки и устаревшего внешнего события.

## 17. Фазы внедрения

1. Базовые таблицы `stock_balances`, `stock_movements`, settings.
2. Adjustment API и history API.
3. Reserve/release/deduct service contracts.
4. Channel override/lock и интеграция с sync.
5. Конфликт-детектор, low-stock и уведомления.

## 18. Нефункциональные требования и SLA

- Любая stock-changing операция должна быть атомарной и устойчивой к повторной доставке внешних событий.
- Расчет `available = on_hand - reserved` должен быть консистентен сразу после завершения транзакции.
- Critical inventory operations должны укладываться в `p95 < 300 мс` для единичного товара.
- Политика отрицательных остатков и race-condition handling должна быть формализована до старта разработки.

## 19. Observability, логи и алерты

- Метрики: `stock_movements_created`, `negative_stock_blocked`, `reserve_release_mismatch`, `low_stock_items`, `inventory_conflicts`.
- Логи: все manual adjust, reserve/release/deduct, reconciliation conflicts.
- Алерты: отрицательный остаток, многократный reserve по одному заказу, расхождения available vs formula, конфликт частых корректировок.
- Dashboards: stock health board, low stock alert board, movement anomaly board.

## 20. Риски реализации и архитектурные замечания

- Главное архитектурное решение: inventory нельзя обновлять “простым set quantity” без traceable movements.
- Нужно заранее выбрать стратегию optimistic/pessimistic locking для reserve path.
- FBS/FBO и warehouse scope должны быть частью ключа учета, иначе остатки станут недостоверными.
- Любая интеграция с orders/sync должна быть идемпотентной на уровне business effect, а не только HTTP/request level.
