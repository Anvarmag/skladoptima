# TASK_WORKER_2 — Generic Worker Runtime, Leases и Graceful Recovery

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `11h`
- Зависимости:
  - `TASK_WORKER_1`
- Что нужно сделать:
  - реализовать generic worker consumer/runtime поверх очереди;
  - ввести lease/lock механику для `in_progress` jobs;
  - обеспечить graceful shutdown и возврат/перевод jobs в recovery-needed состояние;
  - после рестарта корректно requeue/retry orphaned `in_progress` jobs;
  - гарантировать, что API не блокируется на тяжелых background operations.
- Критерий закрытия:
  - worker устойчив к рестартам и redeploy;
  - stuck/orphaned jobs обрабатываются по формализованной policy;
  - длительные операции исполняются вне HTTP-контекста без потери lifecycle signals.

**Что сделано**

### Новые файлы `apps/api/src/modules/worker/`

**`worker-runtime.errors.ts`**
- `JobBlockedError` — кастомный класс ошибки, который обработчик должен бросать когда domain/tenant policy блокирует исполнение. Worker переводит job в статус `blocked` (не `failed`), что соответствует §10 system-analytics.

**`job-handler.interface.ts`**
- `IJobHandler` — контракт для всех доменных обработчиков задач. Метод `handle(job: WorkerJob): Promise<void>`. Обязателен к реализации для каждого job type.

**`job-handler.registry.ts`**
- `JobHandlerRegistry` — центральный реестр: `register(jobType, handler)` + `get(jobType)`. Доменные модули вызывают `register()` в конструкторе. `WorkerRuntimeService` вызывает `get()` перед исполнением.

**`worker-runtime.service.ts`** — ядро runtime, реализует `OnApplicationBootstrap` + `OnApplicationShutdown`:

- **Активация только в worker-режиме**: все методы защищены проверкой `IS_WORKER=true`. HTTP API-сервер не запускает polling loop.

- **`recoverOrphanedJobs()`** — на старте: ищет `in_progress` jobs с `leaseUntil < now` (брошены предыдущим краш/рестартом). Если `attempt >= maxAttempts` — переводит в `dead_lettered` + пишет `worker_failed_jobs`. Иначе — переводит в `retrying` с `nextAttemptAt` по backoff.

- **Polling loop** — три независимых `setInterval` по очередям:
  - `critical` каждые 3 секунды
  - `default` каждые 10 секунд
  - `bulk` каждые 30 секунд

- **`acquireNextJob(queueName)`** — двухшаговое атомарное захватывание job через lease:
  1. `findFirst` — ищет кандидата (status: queued/retrying, nextAttemptAt <= now)
  2. `update` с WHERE условием на статус — атомарный claim; при race condition Prisma бросает P2025, возвращаем `null`
  - Устанавливает `leaseOwner = workerId`, `leaseUntil = now + 10 мин`, инкрементирует `attempt`

- **`executeJob(job)`** — диспатчит в `registry.get(jobType)`:
  - `JobBlockedError` → статус `blocked`, log warn
  - Другие ошибки: если `attempt < maxAttempts` → `retrying` с exponential backoff (30s * 2^(attempt-1), cap 1ч, ±10% jitter)
  - `attempt >= maxAttempts` → `markFinalFailed()` → `dead_lettered` + запись в `worker_failed_jobs`
  - Нет обработчика → `markFinalFailed()` с reason `NO_HANDLER_REGISTERED`

- **Graceful shutdown** (`onApplicationShutdown`):
  1. Устанавливает `isShuttingDown = true`
  2. Очищает все `setInterval` (новые jobs не принимаются)
  3. `awaitActiveJobs()` — ждет завершения текущих jobs до 30 секунд
  4. Если таймаут истек — сбрасывает `leaseUntil = now` у оставшихся jobs → следующий воркер восстановит их через `recoverOrphanedJobs()`

### Обновлённые файлы

**`worker.module.ts`** — добавлены `ScheduleModule.forRoot()`, `WorkerRuntimeService`, `JobHandlerRegistry` в providers и exports.

**`apps/api/src/worker.ts`** — добавлен `app.enableShutdownHooks()`. NestJS теперь перехватывает SIGTERM/SIGINT и вызывает `onApplicationShutdown` хуки перед выходом.

### Критерии закрытия

- [x] Worker устойчив к рестартам — `recoverOrphanedJobs()` восстанавливает брошенные jobs
- [x] Stuck/orphaned jobs обрабатываются по формализованной policy (retry vs dead_letter по attempt count)
- [x] Длительные операции исполняются вне HTTP-контекста — polling активен только при `IS_WORKER=true`
- [x] Lease/lock механика предотвращает двойное исполнение при нескольких worker-инстансах
- [x] Graceful shutdown — не теряет jobs при SIGTERM
