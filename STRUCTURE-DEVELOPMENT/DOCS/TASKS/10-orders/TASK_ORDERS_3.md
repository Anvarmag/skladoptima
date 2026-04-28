# TASK_ORDERS_3 — Internal State Machine и Status Mapping

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ORDERS_1`
  - `TASK_ORDERS_2`
- Что нужно сделать:
  - реализовать mapping внешних marketplace statuses во внутренние состояния;
  - закрепить внутренние статусы `IMPORTED`, `RESERVED`, `CANCELLED`, `FULFILLED`, `DISPLAY_ONLY_FBO`, `UNRESOLVED`;
  - для FBS в MVP считать business-critical только `RESERVED / CANCELLED / FULFILLED`;
  - сохранять `PACKED`, `SHIPPED` и аналоги только в `external_status`, без отдельного внутреннего lifecycle;
  - поддержать переход `UNRESOLVED -> RESERVED` после устранения причин блокировки.
- Критерий закрытия:
  - internal state machine соответствует системной аналитике и не конфликтует с inventory contracts;
  - пользователь видит понятный внутренний статус заказа;
  - промежуточные внешние статусы не усложняют MVP lifecycle.

**Что сделано**

### 1. Новый сервис [order-status-mapper.service.ts](apps/api/src/modules/orders/order-status-mapper.service.ts)

Доменный mapper, отвечающий за **только** маппинг и state machine. Никаких сайд-эффектов — чистая функция, легко тестировать.

#### Mapping политика (§13 MVP)

- **WB FBS** dictionary (`WB_STATUS_MAP`): нормализация по `toLowerCase()`:
  - `new`, `waiting` → `RESERVED`
  - `confirm`/`confirmed`/`sorted`/`on_delivery` → `INTERMEDIATE` (PACKED/SHIPPED-аналоги — остаются в `external_status`, lifecycle не меняют)
  - `sold`, `delivered` → `FULFILLED`
  - `canceled`/`cancelled`/`canceled_by_client`/`declined_by_client`/`defect` → `CANCELLED`
- **Ozon FBS** dictionary (`OZON_STATUS_MAP`):
  - `acceptance_in_progress`, `awaiting_approve`, `awaiting_packaging`, `awaiting_registration`, `awaiting_deliver` → `RESERVED`
  - `arbitration`, `client_arbitration`, `delivering`, `driver_pickup`, `sent_by_seller` → `INTERMEDIATE`
  - `delivered` → `FULFILLED`
  - `cancelled`/`canceled`/`not_accepted` → `CANCELLED`
- **FBO** (любой marketplace) → всегда `INTERMEDIATE` на уровне mapper'а: lifecycle статичен (`DISPLAY_ONLY_FBO` фиксируется при первой ингестии и больше не меняется per §13).
- **Unknown статус** → `INTERMEDIATE` с `reason: 'unknown_status'` + structured-лог `order_status_unknown` (это превращается в §19 метрику `status_mapping_failures` без падения ingestion'а).

#### State machine guard (`isTransitionAllowed`)

Жёсткая матрица §13 в коде:

| from \ to             | RESERVED | CANCELLED | FULFILLED | DISPLAY_ONLY_FBO | UNRESOLVED |
|-----------------------|:--------:|:---------:|:---------:|:----------------:|:----------:|
| `IMPORTED`            | ✓        | ✓         | ✓         | ✓                | ✓          |
| `UNRESOLVED`          | ✓        | ✓         | ✓         | —                | —          |
| `RESERVED`            | —        | ✓         | ✓         | —                | —          |
| `CANCELLED` (terminal)| —        | —         | —         | —                | —          |
| `FULFILLED` (terminal)| —        | —         | —         | —                | —          |
| `DISPLAY_ONLY_FBO`    | —        | —         | —         | —                | —          |

Терминальные состояния (`CANCELLED`/`FULFILLED`/`DISPLAY_ONLY_FBO`) — **не покидаются**. Это §20 риск "не silently overwrite более новые состояния": если приходит late event типа `awaiting_packaging` для уже `FULFILLED` заказа — transition отбивается, заказ остаётся в `FULFILLED`, в логе пишется `order_status_transition_rejected`. `from === to` считается no-op (true).

#### Initial status policy (`resolveInitialStatus`)

Иерархия приоритетов для нового заказа:
1. **FBO** → `DISPLAY_ONLY_FBO` (§13 — FBO не имеет lifecycle).
2. **FBS + unmatched items** → `UNRESOLVED` (§14: warehouse/SKU scope не определён → не резервируем "в никуда"). Это правильное поведение **независимо** от того, что прислал маркетплейс.
3. **FBS + matched** → результат mapper'а: TRANSITION → используем; INTERMEDIATE/unknown → fallback `IMPORTED` (точный business-critical статус будет назначен следующим event'ом со `status_changed`).

### 2. Интеграция в [orders-ingestion.service.ts](apps/api/src/modules/orders/orders-ingestion.service.ts)

- `_deriveInitialStatus` (TASK_2) **заменён** на вызов `statusMapper.resolveInitialStatus(...)` — теперь новый FBS заказ из `/orders/new` (WB) или `awaiting_packaging` (Ozon) сразу попадает в `RESERVED`, а не в `IMPORTED`.
- В **update-ветке** добавлена логика transition:
  1. `mapper.mapExternalToInternal(...)` решает: `INTERMEDIATE` (ничего не делать) или `TRANSITION` (target status).
  2. Если TRANSITION — через `isTransitionAllowed(currentInternal, target)` проверяем, разрешён ли переход.
  3. Если разрешён и фактически меняет статус — добавляем `internalStatus: nextInternalStatus` в `update` и накапливаем `transitionLog`.
  4. Если запрещён — пишем `order_status_transition_rejected` warn-лог и оставляем текущее состояние (никаких silent overwrite).
- **Семантический event** при successful transition (§15):
  - `RESERVED` → `OrderEventType.RESERVED` (бизнес-эквивалент `order_reserved`).
  - `CANCELLED` → `OrderEventType.RESERVE_RELEASED` (бизнес-эквивалент `order_reserve_released`).
  - `FULFILLED` → `OrderEventType.DEDUCTED` (бизнес-эквивалент `order_fulfilled`/inventory deduct).
  - `external_event_id` суффиксуется `#<target_state>` для сохранения UNIQUE.
  - Этот event — источник истины для inventory side-effects, которые подключит **TASK_ORDERS_4** (он будет читать timeline и применять `inventory.reserve/release/deduct`).

### 3. Регистрация в [orders.module.ts](apps/api/src/modules/orders/orders.module.ts)

`OrderStatusMapperService` добавлен в `providers` и `exports` — экспорт нужен на случай, если в TASK_ORDERS_4/5 inventory или REST-слой захочет переиспользовать mapper для UI labels (`internalStatus → human label`).

### 4. Что НЕ требовало правок

- **Sync.service WB/Ozon adapters** — продолжают передавать raw `externalStatus` в `OrdersIngestionService.ingest(...)`. Маппинг живёт строго в orders-домене, sync остаётся "transport layer".
- **`MarketplaceOrder` (legacy)** — не трогается; читатели ещё не переключены, и его `status: String?` хранит raw external value.

### 5. Проверки

- `npx prisma validate` → schema valid (миграций не понадобилось — только code).
- `npx tsc --noEmit -p tsconfig.json` → 0 ошибок в `orders/*`, `sync.service`, `sync.module`. Общий счётчик ошибок остался **20** (все pre-existing в чужих модулях: `fix-ozon-dates.ts`, `test-fbo*.ts`, `update-pwd.ts`, `catalog/import.service*`, `team-scheduler.service.ts`, `sync-runs.regression.spec.ts`).

### 6. DoD сверка

- ✅ **Internal state machine соответствует §13 и не конфликтует с inventory**: target = `RESERVED/CANCELLED/FULFILLED` ровно совпадают с inventory effect contract'ом (TASK_ORDERS_4 будет реагировать на эти три события). Терминальные состояния защищены guard'ом.
- ✅ **Пользователь видит понятный внутренний статус**: новый FBS из `/orders/new` сразу `RESERVED` (а не `IMPORTED`); cancelled posting → `CANCELLED`; delivered → `FULFILLED`. Это попадёт в UI `/api/v1/orders` (TASK_ORDERS_5) как `internalStatus`.
- ✅ **Промежуточные внешние статусы не усложняют MVP lifecycle**: `confirm/sorted/on_delivery` (WB) и `delivering/driver_pickup/sent_by_seller` (Ozon) маппятся в `INTERMEDIATE` — `external_status` обновляется (трасса для UI), `internalStatus` остаётся `RESERVED`. Никаких новых внутренних значений в enum не добавлено.
- ✅ **`UNRESOLVED → RESERVED` поддержан**: state machine разрешает этот переход; следующий event с matched items сможет провести заказ в RESERVED (механизм re-match — задача TASK_ORDERS_4/5 reprocess).
