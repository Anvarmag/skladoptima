# Синхронизация — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `09-sync`

## 1. Назначение модуля

Модуль обеспечивает фоновую pull/push синхронизацию остатков и заказов, фиксацию sync-runs, конфликты, retry-логику и ручной запуск синхронизации.

### Текущее состояние (as-is)

- в backend уже существует модуль `marketplace_sync` с ручными/test/pull/orders/full-sync endpoint;
- sync сейчас реализован как прикладной сервис с рабочими маршрутами, но без полноценного run registry и conflict UI;
- часть текущих flows ориентирована на ручной контроль и отладку, а не на финальный операционный контур.

### Целевое состояние (to-be)

- sync должен работать через явный lifecycle run, item-level diagnostics, retry policy и conflict registry;
- длинные операции не должны блокировать HTTP и обязаны переноситься в worker/scheduler слой;
- sync должен уважать `tenant AccessState` и effective runtime state marketplace account: при `TRIAL_EXPIRED / SUSPENDED / CLOSED` внешние вызовы обязаны останавливаться, а не выполняться "в фоне";
- sync должен быть воспроизводимым, tenant-aware и пригодным для разбора без прямого доступа к базе.


## 2. Функциональный контур и границы

### Что входит в модуль
- orchestration фоновый sync-run по account и типам данных;
- хранение run history, item-level результатов и конфликтов;
- retry/backoff/circuit-breaker поведение;
- ручной и плановый запуск синхронизации;
- preflight-check account/tenant readiness перед любым внешним вызовом;
- стыковка raw external data с доменными модулями orders/inventory/catalog.

### Что не входит в модуль
- бизнес-правила самого inventory, orders и catalog;
- хранение credentials marketplace;
- общая очередь worker как инфраструктурный компонент;
- UI-аналитика beyond operational diagnostics.

### Главный результат работы модуля
- обмен с маркетплейсами выполняется воспроизводимо, диагностируемо и без молчаливых потерь/дублей бизнес-эффекта.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin | Запускает manual sync, смотрит статус | Не управляет low-level retries вручную |
| Manager | Просматривает историю и диагностику | Без запуска ручных sync/retry |
| Scheduler/Worker | Исполняет runs | Основной runtime actor |
| Marketplace adapters | Общаются с внешним API | Возвращают нормализованные ошибки/данные |
| Orders/Inventory/Catalog | Применяют доменные изменения | Не должны скрывать sync origin |

## 4. Базовые сценарии использования

### Сценарий 1. Плановый sync
1. Scheduler создает run по account и набору типов данных.
2. Run ставится в очередь и получает `queued`.
3. Worker последовательно выполняет этапы.
4. Результат каждого этапа фиксируется в `sync_run_items`.
5. Итоговый статус run становится `success`, `partial_success` или `failed`.

### Сценарий 2. Ручной retry failed run
1. Пользователь открывает детали failed run.
2. Запрашивает retry.
3. Backend создает новый run c `trigger_type=retry` и ссылкой на origin run.
4. Worker повторяет только допустимые этапы по политике.

### Сценарий 3. Конфликт синхронизации
1. Run получает событие/данные, которые нельзя безопасно применить автоматически.
2. Сервис фиксирует конфликт и его payload.
3. Run не теряет общий прогресс, но может завершиться `partial_success`.
4. Пользователь и support видят конфликт в diagnostics.

### Сценарий 4. Tenant уходит в `TRIAL_EXPIRED`
1. Tenant переводится в `TRIAL_EXPIRED`.
2. Новые manual и scheduled runs не стартуют во внешний API.
3. Уже поставленные в очередь runs при preflight получают `blocked`, если еще не начали внешний этап.
4. История и диагностика прошлых runs остаются доступными в read-only режиме.

## 5. Зависимости и интеграции

- Marketplace Accounts
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)
- Inventory
- Orders
- Catalog
- Warehouses
- Worker/Queue
- Audit + Notifications

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/sync/runs` | Owner/Admin | Запустить sync вручную |
| `GET` | `/api/v1/sync/runs` | Owner/Admin/Manager | Список запусков |
| `GET` | `/api/v1/sync/runs/:runId` | Owner/Admin/Manager | Детали run |
| `POST` | `/api/v1/sync/runs/:runId/retry` | Owner/Admin | Повторный запуск failed run |
| `GET` | `/api/v1/sync/accounts/:accountId/status` | Owner/Admin/Manager | Последний sync summary по account |
| `GET` | `/api/v1/sync/conflicts` | Owner/Admin/Manager | Конфликты sync |
| `POST` | `/api/v1/sync/full` | Owner/Admin | Полный sync tenant |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/sync/runs \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"mpa_...","syncTypes":["PULL_STOCKS","PULL_ORDERS","PUSH_STOCKS"]}'
```

```json
{
  "runId": "syn_...",
  "status": "QUEUED",
  "syncTypes": ["PULL_STOCKS", "PULL_ORDERS", "PUSH_STOCKS"]
}
```

### Frontend поведение

- Текущее состояние: отдельного полноценного sync UI в web-приложении нет, история и ручные действия представлены фрагментарно.
- Целевое состояние: нужны экраны истории запусков, деталей run, конфликтов и минимального ручного управления sync для MVP.
- UX-правило: пользователь должен понимать, что именно синхронизировалось, где произошла ошибка и какое действие допустимо дальше.
- UI должен различать `failed` и `blocked by policy`: это разные ситуации для пользователя и support.
- При `TRIAL_EXPIRED` sync history остается доступной, но кнопки `sync now`, `retry`, `full sync` блокируются.
- При `SUSPENDED/CLOSED` sync-контур доступен только как read-only diagnostics.
- В MVP ручные действия ограничены `sync now` по account и `retry failed run`; `tenant full sync` не выводится в UI.

## 8. Модель данных (PostgreSQL)

### `sync_runs`
- `id UUID PK`, `tenant_id UUID`, `marketplace_account_id UUID`
- `trigger_type ENUM(manual, scheduled, retry)`
- `trigger_scope ENUM(account, tenant_full)`
- `sync_types TEXT[]` (`PULL_STOCKS`, `PUSH_STOCKS`, `PULL_ORDERS`, `PULL_METADATA`)
- `status ENUM(queued, in_progress, success, partial_success, failed, blocked, cancelled)`
- `origin_run_id UUID NULL`
- `requested_by UUID NULL`
- `blocked_reason VARCHAR(64) NULL`
- `started_at`, `finished_at`, `duration_ms`
- `processed_count INT`, `error_count INT`
- `error_code`, `error_message`

### `sync_run_items`
- `id UUID PK`, `run_id UUID FK`
- `item_type ENUM(stock, order, product, warehouse)`
- `item_key VARCHAR(128)`
- `stage ENUM(preflight, pull, transform, apply, push)`
- `status ENUM(success, failed, skipped, conflict, blocked)`
- `external_event_id VARCHAR(128) NULL`
- `payload JSONB`, `error JSONB`
- в MVP записи создаются только для `failed / conflict / blocked` item-level кейсов; success path хранится агрегатами в `sync_runs`

### `sync_conflicts`
- `id UUID PK`, `tenant_id UUID`, `run_id UUID`
- `entity_type`, `entity_id`, `conflict_type`, `payload JSONB`
- `resolved_at TIMESTAMPTZ NULL`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. API или scheduler создает `sync_run` в статусе `queued` и ставит job в очередь worker.
2. Worker начинает с preflight-check: `tenant state`, `marketplace account lifecycle`, `credential status`, concurrency guard.
3. Если tenant/account policy не допускает внешний вызов, run получает `blocked`, пишет диагностическую причину и не идет дальше.
4. Если preflight успешен, worker выполняет этапы по порядку: pull metadata -> pull orders/stocks -> transform/apply -> push.
5. Каждый этап пишет `sync_run_items` с `stage` и результатом.
6. Временные ошибки -> retry с backoff, фатальные -> failed.
7. Конфликты старых событий фиксируются в `sync_conflicts`, run может быть `partial_success`.
8. Завершение run обновляет `last_sync_at` и `sync health` у account.

## 10. Валидации и ошибки

- Один активный run на account для одинакового типа sync.
- Manual run запрещен, если account не `active` или runtime account находится в paused state.
- `POST /api/v1/sync/full` не входит в MVP runtime surface и остается future/admin-only scope.
- Идемпотентность по `Idempotency-Key`.
- Ошибки:
  - `CONFLICT: SYNC_ALREADY_RUNNING`
  - `FORBIDDEN: SYNC_BLOCKED_BY_TENANT_STATE`
  - `FORBIDDEN: SYNC_BLOCKED_BY_ACCOUNT_STATE`
  - `EXTERNAL_INTEGRATION_ERROR: RATE_LIMIT`
  - `INTERNAL_ERROR: SYNC_STAGE_FAILED`

## 11. Чеклист реализации

- [ ] Таблицы sync runs/conflicts.
- [ ] Queue worker и retry policy.
- [ ] API manual run/retry.
- [ ] Статусы в UI и оповещения об ошибках.
- [ ] Интеграционные тесты partial/failure paths.

## 12. Критерии готовности (DoD)

- Sync не блокирует HTTP.
- По каждому run есть диагностическая история.
- Конфликты не теряются и не применяются молча.
- При `TRIAL_EXPIRED / SUSPENDED / CLOSED` внешний sync не выполняется, а история остается доступной.
- Item-level диагностика в MVP фиксирует только проблемные элементы, а success-поток остается агрегированным.

## 13. Типы sync и порядок выполнения

### Поддерживаемые типы
- `PULL_STOCKS`
- `PULL_ORDERS`
- `PULL_METADATA`
- `PUSH_STOCKS`
- `FULL_SYNC`

### Рекомендуемый порядок `FULL_SYNC`
1. Проверка account status
2. Проверка tenant/account policy
3. Pull справочников
4. Pull orders
5. Применение order effects
6. Pull external informational stocks
7. Push managed available stock

### MVP manual actions
- `sync now` по конкретному account
- `retry failed run`
- `tenant full sync` выносится в future scope

## 14. Идемпотентность и дедупликация

- Каждый внешний event должен иметь `external_event_id` или вычисляемый `fingerprint`.
- Повторная обработка одного и того же external event не должна создавать повторный бизнес-эффект.
- Для run-level идемпотентности используется `Idempotency-Key` или `job_key`.
- Для inventory/order side-effects sync обязан передавать стабильный `source_event_id/external_event_id`, совместимый с политикой дедупликации downstream модулей.

## 15. Webhooks и polling

### На MVP допустима mixed-модель
- polling как основной механизм
- webhook как future-compatible enhancement

### Если webhook появится позже
- входящий webhook кладет event в queue
- вся бизнес-обработка все равно выполняется worker'ом, а не прямо в HTTP handler

## 16. Тестовая матрица

- Успешный manual sync.
- Scheduled sync без ошибок.
- Частичный sync с `partial_success`.
- Retry после временной ошибки.
- Rate-limit сценарий.
- Duplicate external order event.
- Конфликт после ручной inventory корректировки.
- `TRIAL_EXPIRED` блокирует manual и scheduled sync без потери истории.
- `SUSPENDED/CLOSED` блокируют любые внешние этапы run.
- failed preflight переводит run в `blocked`, а не в `failed`.
- success items не создают лишнюю item-level трассу в MVP.

## 17. Фазы внедрения

1. `sync_runs`, `sync_run_items`, `sync_conflicts`.
2. Queue worker orchestration.
3. Pull adapters per marketplace.
4. Push adapters per marketplace.
5. Retry/backoff/conflict diagnostics.

## 18. Нефункциональные требования и SLA

- Manual API только ставит run в очередь; тяжелая обработка по HTTP запрещена.
- Для одного account/type набора должен действовать concurrency control, исключающий наложение одинаковых активных run.
- Scheduler lag и queue lag для critical sync должны контролироваться отдельно; целевой `start lag p95 < 60 сек`.
- Любая неуспешная обработка обязана оставлять диагностический след на уровне run и, при необходимости, item.
- Policy-driven блокировка sync должна быть детерминированной: одинаковый tenant/account state всегда приводит к одинаковому blocked outcome.

## 19. Observability, логи и алерты

- Метрики: `sync_runs_started`, `sync_runs_failed`, `sync_runs_blocked`, `partial_success_rate`, `retry_count`, `queue_lag`, `conflicts_open`.
- Логи: stage start/finish, preflight decisions, external request summary, dedup decisions, conflict payload references.
- Алерты: stuck in-progress run, рост failed/partial, repeated rate-limit, неактуальная freshness по account, аномальный рост blocked runs.
- Dashboards: sync operations board, freshness monitor, conflict backlog board, blocked-runs board.

## 20. Риски реализации и архитектурные замечания

- Нельзя проектировать sync как “один большой job”; нужны этапы и recoverable checkpoints.
- Adapter errors должны нормализоваться в единую taxonomy, иначе support и retry policy будут хаотичны.
- Webhook и polling должны сходиться в единой processing pipeline, иначе дубли неизбежны.
- При расширении числа marketplace критична изоляция падений: сбой одного account не должен останавливать других.
- Если blocked runs смешать с failed runs, support и пользователь не смогут отделить реальные интеграционные инциденты от продуктовых policy-ограничений.
- Если в MVP сохранять полную success item-level трассу, storage и diagnostic noise вырастут быстрее реальной пользы.

## 21. Открытые вопросы к продукту и архитектуре

- Открытых MVP-вопросов по модулю sync больше нет.

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены tenant/account preflight guards, blocked run semantics и открытые решения по manual actions и depth of item-level diagnostics | Codex |
| 2026-04-18 | Подтвержден минимальный manual sync MVP и problem-only item-level reporting | Codex |
