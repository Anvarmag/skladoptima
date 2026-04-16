# Заказы — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль хранит и отображает заказы из маркетплейсов, маппит внешние статусы во внутренние и инициирует бизнес-эффект на остатки только для FBS-заказов.

## 2. Функциональный контур и границы

### Что входит в модуль
- ingestion заказов из маркетплейсов;
- нормализация order header/items/status;
- внутренняя state machine заказа;
- side-effects для inventory и аналитики;
- диагностика duplicate/out-of-order событий.

### Что не входит в модуль
- биллинг покупателя и внешняя касса;
- полноценный OMS/CRM для клиентской коммуникации;
- физическое выполнение и shipping orchestration beyond marketplace statuses;
- финансовый расчет прибыли.

### Главный результат работы модуля
- все внешние заказы tenant представлены как единая доменная модель, по которой можно безопасно строить inventory effects, аналитику и операционные списки.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Sync/Marketplace adapters | Доставляют raw order events | Не применяют бизнес-эффект напрямую |
| Owner/Admin/Manager | Просматривают заказы и статусы | Обычно не редактируют сырой заказ вручную |
| Inventory module | Реагирует на order state changes | Не является источником истины по заказу |
| Analytics/Finance | Читают нормализованные orders | Не меняют lifecycle заказа |

## 4. Базовые сценарии использования

### Сценарий 1. Появление нового заказа
1. Sync доставляет новый external order.
2. Orders service проверяет идемпотентность по external key.
3. Создает order header и order items.
4. Если сценарий влияет на stock, публикует reserve event.
5. Заказ появляется в UI и аналитике.

### Сценарий 2. Обновление статуса заказа
1. Система получает внешний статус change event.
2. Выполняется mapping во внутренний state.
3. Если state change влияет на inventory, создается соответствующий side-effect.
4. История переходов сохраняется.

### Сценарий 3. Duplicate/out-of-order event
1. Сервис получает повторный или устаревший event.
2. По fingerprint/version policy определяется, есть ли новый бизнес-эффект.
3. Если эффекта нет, событие логируется как duplicate/ignored.
4. Повторного reserve/deduct не происходит.

## 5. Зависимости и интеграции

- Sync (источник order events)
- Inventory (reserve/release/deduct)
- Catalog (match SKU)
- Audit

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/orders` | User | Список заказов с фильтрами |
| `GET` | `/api/v1/orders/:orderId` | User | Детали заказа |
| `GET` | `/api/v1/orders/:orderId/timeline` | User | Таймлайн событий заказа |
| `POST` | `/api/v1/orders/poll` | Owner/Admin | Форс-поллинг заказов |
| `POST` | `/api/v1/orders/:orderId/reprocess` | Owner/Admin | Безопасная повторная обработка |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/orders?marketplace=WB&fulfillmentMode=FBS&status=reserved&page=1&limit=20' \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "items": [
    {
      "id": "ord_...",
      "marketplaceOrderId": "WB12345",
      "marketplace": "WB",
      "fulfillmentMode": "FBS",
      "externalStatus": "new",
      "internalStatus": "reserved",
      "affectsStock": true
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

## 8. Модель данных (PostgreSQL)

### `orders`
- `id UUID PK`, `tenant_id UUID`
- `marketplace ENUM(wb, ozon, yandex_market)`
- `marketplace_account_id UUID`
- `marketplace_order_id VARCHAR(128) NOT NULL`
- `fulfillment_mode ENUM(fbs, fbo)`
- `external_status VARCHAR(128)`
- `internal_status ENUM(new, reserved, cancelled, fulfilled, display_only_fbo)`
- `affects_stock BOOLEAN`
- `order_created_at TIMESTAMPTZ`, `processed_at TIMESTAMPTZ`
- `UNIQUE(tenant_id, marketplace, marketplace_order_id)`

### `order_items`
- `id UUID PK`, `order_id UUID FK`
- `product_id UUID NULL`, `sku VARCHAR(128)`, `name VARCHAR(255)`
- `quantity INT NOT NULL`, `price NUMERIC(12,2) NULL`

### `order_events`
- `id UUID PK`, `tenant_id UUID`, `order_id UUID`
- `event_type ENUM(received, status_changed, reserved, reserve_released, deducted, return_logged, duplicate_ignored)`
- `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Внешнее событие order -> найти/создать `orders` по уникальному ключу.
2. Если дубль события (idempotency) — записать `duplicate_ignored`, бизнес-эффект не повторять.
3. FBS новый заказ -> резерв (`inventory reserve`).
4. FBS cancelled -> release reserve.
5. FBS fulfilled -> final deduct.
6. FBO orders храним и показываем, но `affects_stock=false`.

## 10. Валидации и ошибки

- Запрет ручного редактирования статусов на MVP.
- Если SKU не сопоставлен — заказ сохраняется, item помечается `unmatched`.
- Ошибки:
  - `CONFLICT: ORDER_ALREADY_PROCESSED`
  - `NOT_FOUND: ORDER_NOT_FOUND`
  - `INTERNAL_ERROR: ORDER_EFFECT_APPLY_FAILED`

## 11. Чеклист реализации

- [ ] Таблицы orders/items/events.
- [ ] Idempotent ingestion use-case.
- [ ] Маппинг external->internal статусов.
- [ ] Связка с inventory service.
- [ ] API list/details/timeline.

## 12. Критерии готовности (DoD)

- Повторное событие не дублирует reserve/deduct.
- FBS/FBO обрабатываются по разным правилам.
- История событий заказа полностью трассируема.

## 13. State machine заказа

### Внутренние статусы
- `NEW`
- `RESERVED`
- `CANCELLED`
- `FULFILLED`
- `DISPLAY_ONLY_FBO`

### Основные переходы
- `NEW -> RESERVED`
- `RESERVED -> CANCELLED`
- `RESERVED -> FULFILLED`
- `NEW -> DISPLAY_ONLY_FBO`

## 14. Правила работы с order items

- Один заказ может содержать несколько строк `order_items`.
- Матчинг товара выполняется по SKU / external mapping.
- Если SKU не найден, item сохраняется в заказе, но не участвует в stock-effect, пока не будет resolved.

## 15. Async и события

- `order_received`
- `order_deduplicated`
- `order_status_normalized`
- `order_reserved`
- `order_reserve_released`
- `order_fulfilled`
- `order_return_logged`

### Что выполняется в фоне
- polling/import orders
- применение stock-effect
- повторная обработка временно неуспешных order events

## 16. Тестовая матрица

- Новый FBS order.
- Новый FBO order.
- Duplicate event того же заказа.
- Cancel order после reserve.
- Fulfill order после reserve.
- Return event без автопополнения stock.
- Unmatched SKU в order item.

## 17. Фазы внедрения

1. `orders`, `order_items`, `order_events`.
2. Ingestion + idempotency layer.
3. Internal status mapping.
4. Inventory side-effects.
5. Timeline/details UI and API.

## 18. Нефункциональные требования и SLA

- Order ingestion должен быть идемпотентным и устойчивым к duplicate/out-of-order delivery.
- Read API списка заказов должен поддерживать пагинацию и целевой `p95 < 500 мс` на стандартных фильтрах.
- State transitions и inventory side-effects должны быть атомарно связаны или компенсируемы.
- История статусов заказа должна сохраняться без потери provenance внешнего события.

## 19. Observability, логи и алерты

- Метрики: `orders_ingested`, `duplicate_order_events`, `status_mapping_failures`, `unmatched_sku_orders`, `order_side_effect_failures`.
- Логи: ingestion result, mapping decisions, skipped/ignored events, inventory effect correlation ids.
- Алерты: рост duplicate events, массовые unmatched SKU, repeated side-effect failures, stuck pending statuses.
- Dashboards: order ingestion board, status distribution, unmatched backlog and duplicate monitor.

## 20. Риски реализации и архитектурные замечания

- Ключевое решение: внутренний статус должен быть отдельной моделью, а не копией внешнего marketplace enum.
- Если side-effects inventory будут вызываться вне контролируемой orchestration-точки, быстро появятся двойные резервы и гонки.
- Нужно заранее определить политику, какие заказы влияют на stock и на каком этапе.
- Исторические order events не должны silently overwrite более новые состояния без version/ordering rules.
