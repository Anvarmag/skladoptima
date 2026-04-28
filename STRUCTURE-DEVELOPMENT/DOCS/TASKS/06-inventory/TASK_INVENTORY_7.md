# TASK_INVENTORY_7 — QA, Regression и Observability Inventory

> Модуль: `06-inventory`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_INVENTORY_2`
  - `TASK_INVENTORY_3`
  - `TASK_INVENTORY_4`
  - `TASK_INVENTORY_5`
  - `TASK_INVENTORY_6`
- Что нужно сделать:
  - собрать regression пакет на manual adjust, reserve/release/deduct, low-stock, conflicts, idempotent replay;
  - покрыть отрицательный остаток, repeated `source_event_id`, stale external events, return logging;
  - проверить поведение inventory в `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - настроить метрики, логи и alerts по movement anomalies, negative stock blocks и idempotency collisions.
- Критерий закрытия:
  - inventory модуль подтвержден проверяемой регрессией;
  - stock correctness risks закрыты тестами;
  - observability достаточна для расследования расхождений остатков.

**Что сделано**

### Контекст MVP до задачи

К моменту начала этой задачи в inventory-модуле уже было **73 unit-теста** в 4
файлах (`inventory.service.spec.ts`, `inventory.orders.spec.ts`,
`inventory.reconcile.spec.ts`, `inventory.tenant-state.spec.ts`) и десятки
structured-логов с разбросанными строковыми именами событий. Однако:

- §17 system-analytics test matrix не была явно покрыта одним сценарным
  файлом — QA не имел читаемого reference, как пройти регрессию по матрице.
- Имена событий в `Logger.log/warn` указывались как магические строки —
  опечатка ломает алертинг и затрудняет grep.
- §20 system-analytics требовал метрики (`stock_movements_created`,
  `negative_stock_blocked`, `reserve_release_mismatch`, `low_stock_items`,
  `inventory_conflicts`), описание дашбордов и алертов — runbook отсутствовал.
- Не было документа, объясняющего «когда событие появилось → что делать
  оператору».

### Что добавлено

**1. Каноничные имена событий — [inventory.events.ts](apps/api/src/modules/inventory/inventory.events.ts)**

Один файл со всеми 13 событиями inventory-модуля, экспортированными через
`as const` объект `InventoryEvents`. Тип `InventoryEventName` — union всех
возможных значений. Файл служит:
- single source of truth — попытка опечатки в логе блокируется TypeScript-ом;
- индексом для observability runbook'а (раздел 1 INVENTORY_OBSERVABILITY.md);
- стабильной поверхностью для будущей интеграции Prometheus/OpenTelemetry.

`inventory.service.ts` отрефакторен: 13 строковых литералов в `event: '...'`
заменены на `event: InventoryEvents.X` ссылки. Любое последующее переименование
будет атомарным.

**2. Регрессионный пакет — [inventory.regression.spec.ts](apps/api/src/modules/inventory/inventory.regression.spec.ts)**

Один файл, в котором каждый describe-блок соответствует одной строке матрицы
§17 system-analytics:

| §17 | describe в файле | Что покрыто |
|---|---|---|
| §17.1 | `§17.1 — ручное увеличение остатка` | MANUAL_ADD movement + ADJUSTMENT_APPLIED event |
| §17.2 | `§17.2 — ручное уменьшение до нуля` | targetQuantity=0 при onHand>0 |
| §17.3 | `§17.3 — попытка уйти ниже нуля` | NEGATIVE_STOCK_NOT_ALLOWED, движение не пишется |
| §17.4 | `§17.4 — два последовательных reserve` | Накопление reserved через два sourceEventId |
| §17.5 | `§17.5 — повтор того же source_event_id` | APPLIED-lock → IGNORED, ORDER_EFFECT_IDEMPOTENT_REPLAY event |
| §17.6 | `§17.6 — cancel после reserve` | release уменьшает reserved, ORDER_RELEASED |
| §17.7 | `§17.7 — fulfill после reserve` | deduct снимает reserved+onHand, Product.total bridge |
| §17.8 | `§17.8 — устаревшее внешнее событие` | reconcile с externalEventAt < локального → IGNORED_STALE + RECONCILE_STALE_EVENT_IGNORED |
| §17.9-10 | `§17.9-10 — manual adjust в paused state` | ForbiddenException для TRIAL_EXPIRED/SUSPENDED/CLOSED + MANUAL_WRITE_BLOCKED_BY_TENANT event |
| §16+17 | `§16+17 — order side-effect в paused state` | reserve в TRIAL_EXPIRED → IGNORED, lock IGNORED, ORDER_EFFECT_PAUSED_BY_TENANT event |
| доп | `Return logging — no auto-restock policy` | RETURN_LOGGED БЕЗ изменения onHand/reserved + RETURN_LOGGED event |
| доп | `Reconciliation — CONFLICT_DETECTED без silent overwrite` | расхождение → CONFLICT_DETECTED movement, остаток НЕ меняется + RECONCILE_CONFLICT_DETECTED event |
| §14 | `FBS/FBO boundary` | reserve > onHand разрешён для isExternal=true; computeEffectiveAvailable исключает FBO физически (where: { isExternal: false }) |
| §20 | `Observability — diagnostics rollup за 24h` | проверены все 5 ключевых метрик: locks/conflicts/reserve_release_fail/deduct_fail |
| доп | `Low-stock contract для notifications` | формат `{threshold, count, items[]}` с `source: 'balance' | 'product_fallback'` |
| доп | `Validation matrix` | ADJUSTMENT_MODE_REQUIRED, SOURCE_EVENT_ID_REQUIRED, ITEM_QTY_INVALID, RELEASE_EXCEEDS_RESERVED, EXTERNAL_AVAILABLE_INVALID, NotFound |

Тесты используют `jest.spyOn(Logger.prototype, 'log/warn')` для проверки, что
канонические event-имена реально эмитятся — это закрывает регрессию для
observability-слоя одновременно с бизнес-логикой.

**3. Observability runbook — [INVENTORY_OBSERVABILITY.md](STRUCTURE-DEVELOPMENT/DOCS/TASKS/06-inventory/INVENTORY_OBSERVABILITY.md)**

7 разделов:

1. Каноничные события — таблица всех 13 событий с severity и эмиттером.
2. Соответствие метрикам §20 — каждая метрика отображена на источник (event/SQL count/diagnostics endpoint).
3. Алерт-пороги P0/P1 — six алертов с условиями, severity и playbook'ом «что делать».
4. Диагностические запросы — конкретные curl-команды на `/diagnostics`, `/effect-locks`, `/conflicts`, `/movements` для расследования инцидентов.
5. Дашборды — рекомендованный набор из 4 boards (Stock Health, Movement Anomaly, Side-effect Idempotency, Source-of-Change Conflict).
6. Регрессионная карта — отображение §17 матрицы на тестовые блоки.
7. Когда дополнять — правило «новое событие → константа + runbook + тест».

Этот документ закрывает «настроить метрики, логи и alerts» из DoD задачи в
объёме, который не требует развёртывания Prometheus/Grafana прямо сейчас:
спецификация написана так, что будущий integration-таск возьмёт её и
сконфигурирует scraping без дополнительного дизайна.

### Проверки

- `npx jest src/modules/inventory/` — `Tests: 97 passed, 97 total` (73 ранее + 24 в новом regression-spec; 5 test suites passed).
- `npx tsc --noEmit` (apps/api) — никаких новых ошибок типизации.
- Каждый regression-сценарий явно проверяет соответствующий
  `InventoryEvents.X` через spy на `Logger.prototype.log/warn` — observability
  и бизнес-инвариант покрыты в одном тесте.

### Соответствие критериям закрытия

- **Inventory модуль подтверждён проверяемой регрессией**: 97 unit-тестов
  в 5 файлах, regression-spec явно отображён на §17 system-analytics, можно
  пройти одним прогоном и увидеть pass-by-pass.
- **Stock correctness risks закрыты тестами**: negative stock (manual + deduct
  пути), reserve/release mismatch, idempotent replay, stale external events,
  return policy (no auto-restock), tenant-state pause, FBS/FBO boundary —
  всё имеет свой именованный тест.
- **Observability достаточна для расследования расхождений**:
  `INVENTORY_OBSERVABILITY.md` runbook + каноничные event-имена +
  diagnostics endpoints позволяют от любого алерта дойти до конкретного
  `sourceEventId`/`movementId` и таблицы за 5 минут.

### Что осталось вне scope

- Реальная интеграция метрик в Prometheus / OpenTelemetry — требует
  изменения инфраструктуры приложения; runbook §3 готов для приёмки
  таска.
- E2E supertest на REST endpoints inventory с реальной базой —
  отдельный QA-таск (юнит-тесты и интеграционные DB-тесты живут в
  разных слоях стратегии тестирования).
- Frontend dashboard для алертов на основании `/diagnostics` —
  заметная часть уже доступна на вкладке «Диагностика» в
  `Inventory.tsx` (TASK_INVENTORY_6); расширение до push-уведомлений —
  отдельная задача в `12-notifications`.
