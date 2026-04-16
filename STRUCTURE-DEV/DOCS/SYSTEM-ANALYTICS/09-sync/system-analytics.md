# Синхронизация — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль обеспечивает фоновую pull/push синхронизацию остатков и заказов, фиксацию sync-runs, конфликты, retry-логику и ручной запуск синхронизации.

## 2. Функциональный контур и границы

### Что входит в модуль
- orchestration фоновый sync-run по account и типам данных;
- хранение run history, item-level результатов и конфликтов;
- retry/backoff/circuit-breaker поведение;
- ручной и плановый запуск синхронизации;
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

## 5. Зависимости и интеграции

- Marketplace Accounts
- Inventory
- Orders
- Worker/Queue
- Audit + Notifications

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/sync/runs` | Owner/Admin | Запустить sync вручную |
| `GET` | `/api/v1/sync/runs` | Owner/Admin/Manager | Список запусков |
| `GET` | `/api/v1/sync/runs/:runId` | Owner/Admin/Manager | Детали run |
| `POST` | `/api/v1/sync/runs/:runId/retry` | Owner/Admin | Повторный запуск failed run |
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

## 8. Модель данных (PostgreSQL)

### `sync_runs`
- `id UUID PK`, `tenant_id UUID`, `marketplace_account_id UUID`
- `trigger_type ENUM(manual, scheduled, retry)`
- `sync_types TEXT[]` (`PULL_STOCKS`, `PUSH_STOCKS`, `PULL_ORDERS`, `PULL_METADATA`)
- `status ENUM(queued, in_progress, success, partial_success, failed)`
- `started_at`, `finished_at`, `duration_ms`
- `processed_count INT`, `error_count INT`
- `error_code`, `error_message`

### `sync_run_items`
- `id UUID PK`, `run_id UUID FK`
- `item_type ENUM(stock, order, product, warehouse)`
- `item_key VARCHAR(128)`
- `status ENUM(success, failed, skipped, conflict)`
- `payload JSONB`, `error JSONB`

### `sync_conflicts`
- `id UUID PK`, `tenant_id UUID`, `run_id UUID`
- `entity_type`, `entity_id`, `conflict_type`, `payload JSONB`
- `resolved_at TIMESTAMPTZ NULL`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. API создает `sync_run` в статусе `queued` и ставит job в очередь worker.
2. Worker выполняет этапы по порядку: pull -> order processing -> push.
3. Каждый этап пишет `sync_run_items`.
4. Временные ошибки -> retry с backoff, фатальные -> failed.
5. Конфликты старых событий фиксируются в `sync_conflicts`, run может быть `partial_success`.
6. Завершение run обновляет `last_sync_at` у account.

## 10. Валидации и ошибки

- Один активный run на account для одинакового типа sync.
- Идемпотентность по `Idempotency-Key`.
- Ошибки:
  - `CONFLICT: SYNC_ALREADY_RUNNING`
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

## 13. Типы sync и порядок выполнения

### Поддерживаемые типы
- `PULL_STOCKS`
- `PULL_ORDERS`
- `PULL_METADATA`
- `PUSH_STOCKS`
- `FULL_SYNC`

### Рекомендуемый порядок `FULL_SYNC`
1. Проверка account status
2. Pull справочников
3. Pull orders
4. Применение order effects
5. Pull external informational stocks
6. Push managed available stock

## 14. Идемпотентность и дедупликация

- Каждый внешний event должен иметь `external_event_id` или вычисляемый `fingerprint`.
- Повторная обработка одного и того же external event не должна создавать повторный бизнес-эффект.
- Для run-level идемпотентности используется `Idempotency-Key` или `job_key`.

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

## 19. Observability, логи и алерты

- Метрики: `sync_runs_started`, `sync_runs_failed`, `partial_success_rate`, `retry_count`, `queue_lag`, `conflicts_open`.
- Логи: stage start/finish, external request summary, dedup decisions, conflict payload references.
- Алерты: stuck in-progress run, рост failed/partial, repeated rate-limit, неактуальная freshness по account.
- Dashboards: sync operations board, freshness monitor, conflict backlog board.

## 20. Риски реализации и архитектурные замечания

- Нельзя проектировать sync как “один большой job”; нужны этапы и recoverable checkpoints.
- Adapter errors должны нормализоваться в единую taxonomy, иначе support и retry policy будут хаотичны.
- Webhook и polling должны сходиться в единой processing pipeline, иначе дубли неизбежны.
- При расширении числа marketplace критична изоляция падений: сбой одного account не должен останавливать других.
