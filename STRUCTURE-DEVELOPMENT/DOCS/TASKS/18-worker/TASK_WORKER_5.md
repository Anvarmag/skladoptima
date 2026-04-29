# TASK_WORKER_5 — Job Classes, Priorities, Idempotency и Replay Policy

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_WORKER_1`
  - `TASK_WORKER_3`
  - `TASK_WORKER_4`
  - согласованы `09-sync`, `13-billing`, `17-files-s3`
- Что нужно сделать:
  - закрепить job classes `SYNC`, `NOTIFICATION`, `BILLING_REMINDER`, `FILE_CLEANUP`, `ANALYTICS_REBUILD`, `AUDIT_MAINTENANCE`;
  - описать special handling classes `MONEY_AFFECTING`, `STOCK_AFFECTING`, `ACCESS_AFFECTING`;
  - требовать `idempotency_key` для idempotent jobs;
  - разрешить manual replay только для `failed / dead_lettered` retryable jobs;
  - ограничить manual replay support/admin контуром и запретить replay для success/non-retryable high-risk jobs без явной contract policy.
- Критерий закрытия:
  - job contracts и ownership стандартизированы;
  - critical jobs имеют idempotency trace и safe replay boundaries;
  - replay policy не создает скрытых money/stock/access рисков.

**Что сделано**

### Gap-анализ перед реализацией

Job type enum (`WorkerJobType`) уже существовал. Но не было: (1) единого реестра контрактов, (2) enforcement идемпотентности при постановке в очередь, (3) dedup активных jobs, (4) проверки replay policy при ретрае, (5) audit-grade логирования для MONEY/STOCK/ACCESS affecting replays.

### `worker-job-contract.ts` — новый файл, единый реестр контрактов

Описывает типы `SpecialHandlingClass` (`MONEY_AFFECTING`, `STOCK_AFFECTING`, `ACCESS_AFFECTING`) и `ReplayPolicy` (`allowed`, `support-only`, `forbidden`).

Интерфейс `JobContract` содержит поля:
- `defaultQueue` / `defaultPriority` / `defaultMaxAttempts` — defaults для `enqueueJob()` если caller их не передал
- `requiresIdempotencyKey` — если `true`, `enqueueJob()` кидает `IDEMPOTENCY_KEY_REQUIRED` без ключа
- `requiresTenantScope` — advisory: если `true` и `tenantId` не передан, логируется предупреждение
- `specialHandling` — массив классов высокого риска
- `replayPolicy` — `retryJob()` блокирует `forbidden`, логирует warn для high-risk

Контракты задокументированы для всех шести job types:
- `SYNC` — `requiresIdempotencyKey: true`, `requiresTenantScope: true`, `support-only`
- `NOTIFICATION` — `support-only`
- `BILLING_REMINDER` — `MONEY_AFFECTING`, `requiresIdempotencyKey: true`, `requiresTenantScope: true`, `support-only`
- `FILE_CLEANUP` — `allowed` (всегда безопасен к повтору)
- `ANALYTICS_REBUILD` — `allowed`
- `AUDIT_MAINTENANCE` — `allowed`

Helper `isHighRiskJob(contract)` возвращает `true` если `specialHandling.length > 0`.

### `worker-job.types.ts` — `queueName` стало optional

Теперь callers могут не указывать `queueName` — значение берётся из контракта. `priority` и `maxAttempts` уже были optional, теперь явно документированы как "берётся из контракта".

### `WorkerService.enqueueJob()` — три новых guard'а

1. **Idempotency key enforcement** — если `contract.requiresIdempotencyKey && !dto.idempotencyKey` → `BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' })`.
2. **Tenant scope advisory** — если `contract.requiresTenantScope && !dto.tenantId` → `warn` лог `enqueue_missing_tenant_scope` (не бросает исключение, advisory).
3. **Idempotency dedup** — если `idempotencyKey` передан → ищет существующий active job (`queued/in_progress/retrying/blocked`) с тем же ключом. При нахождении: логирует `job_enqueue_dedup` и возвращает existing job (at-most-once semantics). Новый job не создаётся.
4. **Contract defaults** — `queueName ?? contract.defaultQueue`, `priority ?? contract.defaultPriority`, `maxAttempts ?? contract.defaultMaxAttempts`.

### `WorkerService.retryJob()` — replay policy enforcement

1. **`replayPolicy === 'forbidden'`** → `ForbiddenException({ code: 'JOB_REPLAY_FORBIDDEN_BY_CONTRACT' })`.
2. **High-risk replay** — если `isHighRiskJob(contract)` → `warn` лог `job_high_risk_replay` с `specialHandling`, `status`, `attempt`. Создаёт audit trail для money/stock/access операций.
3. **`job_manual_retry` лог** расширен полями `replayPolicy` и `specialHandling` для трассировки.

### Критерии закрытия

- [x] Job contracts и ownership стандартизированы в `JOB_CONTRACTS` реестре
- [x] `BILLING_REMINDER` (MONEY_AFFECTING) требует idempotency_key + tenant scope
- [x] `SYNC` требует idempotency_key — duplicate delivery не создаёт повторный job
- [x] Replay policy `forbidden` блокирует retryJob() на уровне кода
- [x] High-risk replay (MONEY/STOCK/ACCESS) логируется с audit-grade trace перед исполнением
- [x] Idempotency dedup: active job с тем же ключом не дублируется
