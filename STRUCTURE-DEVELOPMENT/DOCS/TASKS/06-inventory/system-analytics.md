# Остатки (Inventory) — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `06-inventory`

## 1. Назначение модуля

Модуль управляет master/FBS-остатком, резервами под заказы, ручными корректировками, историей движений и доступным остатком для синхронизации с каналами.

### Текущее состояние (as-is)

- выделенного inventory backend-модуля и отдельного inventory UI в текущем проекте нет;
- часть складской логики пока живет рядом с каталогом через `stock-adjust`, а не в самостоятельном доменном слое;
- резервы, движения, available balance и каналный override policy пока описаны как целевая архитектура следующего этапа.

### Целевое состояние (to-be)

- inventory должен стать отдельным транзакционным модулем с balances, movements, reserve, release и deduct;
- любой внешний или ручной side effect обязан проходить через доменную политику и audit;
- inventory read model должна быть устойчивой к stale events и конкурентным операциям;
- write-path inventory должен учитывать tenant `AccessState`, чтобы read-only/suspended tenant не менял управляемый остаток вручную.


## 2. Функциональный контур и границы

### Что входит в модуль
- хранение балансов, резервов и доступного остатка;
- ручные корректировки и системные stock movements;
- разрезы по складам, fulfillment mode и каналам;
- защита от отрицательных остатков по политике MVP;
- подготовка данных для push stocks и order side-effects;
- идемпотентность inventory effects для orders/sync.

### Что не входит в модуль
- справочник складов как внешний reference layer;
- ingestion заказов и внешних событий как самостоятельный домен;
- финансовая оценка stock value;
- физическая WMS/ячеистое хранение и инвентаризация уровня enterprise;
- каналные lock/override правила как пользовательская настройка MVP.

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
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)
- Notifications (low stock)
- Audit

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/inventory/stocks` | User | Список остатков по товарам |
| `GET` | `/api/v1/inventory/stocks/:productId` | User | Детализация по складам/каналам |
| `POST` | `/api/v1/inventory/adjustments` | Owner/Admin/Manager | Ручная корректировка |
| `GET` | `/api/v1/inventory/movements` | User | История движений |
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

### Frontend поведение

- Текущее состояние: в web-клиенте нет отдельного маршрута inventory, а складские изменения представлены фрагментарно.
- Целевое состояние: нужны экраны balances, movements, thresholds и manual adjustments.
- UX-правило: пользователь должен видеть не только остаток, но и причину изменения, резерв и блокировку write-операций.
- при `TRIAL_EXPIRED` inventory остается доступным в read-only режиме без ручных корректировок;
- при `SUSPENDED` и `CLOSED` manual write-actions inventory блокируются полностью, а UI должен показывать reason и CTA в billing/поддержку.

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
- `source_event_id VARCHAR(128) NULL`
- `idempotency_key VARCHAR(128) NULL`
- `actor_user_id UUID NULL`, `created_at`

### `inventory_effect_locks`
- `id UUID PK`
- `tenant_id UUID`
- `effect_type ENUM(order_reserve, order_release, order_deduct, sync_reconcile)`
- `source_event_id VARCHAR(128) NOT NULL`
- `status ENUM(processing, applied, ignored, failed) NOT NULL`
- `created_at`, `updated_at`
- `UNIQUE(tenant_id, effect_type, source_event_id)`

### `inventory_settings`
- `tenant_id UUID PK`, `low_stock_threshold INT NOT NULL DEFAULT 5`

## 9. Сценарии и алгоритмы (step-by-step)

1. Ручная корректировка: транзакция `SELECT ... FOR UPDATE` по `stock_balances`, запрет отрицательного `on_hand`.
2. При order reserve: сначала проверить `inventory_effect_locks`, затем `reserved + qty`, `available` уменьшается.
3. При order cancel: `reserved - qty`, `available` восстанавливается.
4. При order fulfilled: `reserved - qty`, `on_hand - qty`.
5. Возврат: создается movement `return_logged`, автоплюс в `on_hand` не делаем.
6. Любой manual write-path проверяет tenant `AccessState` перед изменением управляемого остатка.

## 10. Валидации и ошибки

- `delta != 0`, `reason` обязателен для manual корректировки.
- Нельзя уйти в отрицательный `on_hand`.
- Запрет manual inventory write-actions при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
- Повторное применение order side-effect с тем же business event должно игнорироваться идемпотентно.
- Ошибки:
  - `CONFLICT: NEGATIVE_STOCK_NOT_ALLOWED`
  - `NOT_FOUND: STOCK_BALANCE_NOT_FOUND`
  - `FORBIDDEN: INVENTORY_WRITE_BLOCKED_BY_TENANT_STATE`
  - `CONFLICT: INVENTORY_EFFECT_ALREADY_APPLIED`
  - `FORBIDDEN: STOCK_ADJUST_NOT_ALLOWED`

## 11. Чеклист реализации

- [ ] Миграции stock-модели.
- [ ] Транзакционные сервисы reserve/release/deduct.
- [ ] API для adjustments/history.
- [ ] Конфликт-детектор устаревших внешних событий.
- [ ] Low-stock правила + интеграция с notifications.

## 12. Критерии готовности (DoD)

- Движения остатков полностью трассируемы.
- Отрицательные остатки невозможны.
- Повторные order events не создают повторный reserve/release/deduct.

## 13. Транзакционные правила

- Любая операция над остатком выполняется в БД-транзакции.
- Для строки `stock_balances` используется блокировка `FOR UPDATE`.
- Источник истины для расчета: `on_hand`, `reserved`; `available` вычисляется, а не хранится вручную бизнес-логикой.
- История движения (`stock_movements`) пишется в той же транзакции, что и изменение остатка.
- Idempotency lock для внешнего/business event фиксируется в той же транзакции, что и side-effect, либо компенсируется надежным outbox-паттерном.

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

### Требования к контракту Orders -> Inventory
- каждый вызов обязан нести стабильный `source_event_id`;
- один и тот же `source_event_id` не должен повторно менять баланс;
- inventory не должен доверять order side-effect без tenant/product/warehouse scope.

### Inventory -> Sync
- после успешной ручной корректировки
- после финального изменения `available`

### Что передавать в sync
- `product_id`
- `marketplace_account_id`
- `effective_available_qty`
- `reason`
- `source_event_id`

## 16. Политика по tenant AccessState

### `TRIAL_EXPIRED`
- inventory доступен в read-only режиме;
- manual adjustments и другие write-actions запрещены;
- интеграции с маркетплейсами и их API-вызовы ставятся на паузу;
- новые order/sync-driven side-effects из внешних каналов не обрабатываются, пока tenant находится в `TRIAL_EXPIRED`.

### `SUSPENDED`
- manual write-actions inventory запрещены;
- downstream push в каналы определяется общей commercial policy;
- доступен просмотр истории и диагностики.

### `CLOSED`
- пользовательский доступ к inventory прекращается;
- модуль остается доступен только для внутренних retention/support процессов по общей tenant policy.

## 17. Тестовая матрица

- Ручное увеличение остатка.
- Ручное уменьшение остатка до нуля.
- Попытка уменьшить ниже нуля.
- Reserve двух заказов подряд.
- Повторный reserve того же `source_event_id`.
- Cancel после reserve.
- Fulfill после reserve.
- Конфликт ручной корректировки и устаревшего внешнего события.
- Попытка manual adjust в `TRIAL_EXPIRED`.
- Попытка manual adjust в `SUSPENDED/CLOSED`.

## 18. Фазы внедрения

1. Базовые таблицы `stock_balances`, `stock_movements`, settings.
2. Adjustment API и history API.
3. Reserve/release/deduct service contracts.
4. Idempotency locks для orders/sync effects.
5. Tenant-state guards, конфликт-детектор, low-stock и уведомления.

## 19. Нефункциональные требования и SLA

- Любая stock-changing операция должна быть атомарной и устойчивой к повторной доставке внешних событий.
- Расчет `available = on_hand - reserved` должен быть консистентен сразу после завершения транзакции.
- Critical inventory operations должны укладываться в `p95 < 300 мс` для единичного товара.
- Политика отрицательных остатков и race-condition handling должна быть формализована до старта разработки.
- Inventory write-guards должны срабатывать одинаково для UI, orders-side effects и sync-related paths по согласованной policy.

## 20. Observability, логи и алерты

- Метрики: `stock_movements_created`, `negative_stock_blocked`, `reserve_release_mismatch`, `low_stock_items`, `inventory_conflicts`.
- Логи: все manual adjust, reserve/release/deduct, reconciliation conflicts.
- Алерты: отрицательный остаток, многократный reserve по одному заказу, расхождения available vs formula, конфликт частых корректировок, repeated idempotency collisions.
- Dashboards: stock health board, low stock alert board, movement anomaly board, side-effect idempotency board.

## 21. Риски реализации и архитектурные замечания

- Главное архитектурное решение: inventory нельзя обновлять “простым set quantity” без traceable movements.
- Нужно заранее выбрать стратегию optimistic/pessimistic locking для reserve path.
- FBS/FBO и warehouse scope должны быть частью ключа учета, иначе остатки станут недостоверными.
- Любая интеграция с orders/sync должна быть идемпотентной на уровне business effect, а не только HTTP/request level.
- Если order side-effects не будут иметь стабильный `source_event_id`, появятся двойные резервы и непредсказуемые расхождения.

## 22. Открытые вопросы к продукту и архитектуре

- На текущий момент открытых продуктовых вопросов по MVP inventory не осталось.

## 23. Подтвержденные продуктовые решения

- отрицательный остаток в MVP не поддерживается и запрещен полностью без исключений;
- при `TRIAL_EXPIRED` интеграции маркетплейсов и их API-вызовы ставятся на паузу, inventory остается в read-only режиме.
- lock/override по каналам в MVP не поддерживаются и переносятся в future scope.

## 24. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Idempotency policy, tenant-state guards и FBS/FBO границы описаны явно.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 25. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Доработаны tenant-state guards, idempotency side-effects и открытые вопросы по negative stock/override/TRIAL_EXPIRED policy | Codex |
| 2026-04-18 | Зафиксированы решения по запрету negative stock и operational freeze интеграций в `TRIAL_EXPIRED` | Codex |
| 2026-04-18 | Зафиксирован перенос channel lock/override в future scope | Codex |
