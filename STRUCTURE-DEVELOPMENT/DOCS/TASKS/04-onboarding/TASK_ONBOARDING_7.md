# TASK_ONBOARDING_7 — QA, Regression, Funnel Tracking и Observability

> Модуль: `04-onboarding`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `7h`
- Зависимости:
  - `TASK_ONBOARDING_2`
  - `TASK_ONBOARDING_3`
  - `TASK_ONBOARDING_4`
  - `TASK_ONBOARDING_5`
  - `TASK_ONBOARDING_6`
- Что нужно сделать:
  - собрать regression пакет на start/skip/reopen/complete/resume;
  - покрыть handoff от `user_bootstrap` к `tenant_activation`;
  - проверить auto-complete шагов по доменным событиям;
  - проверить поведение onboarding в `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - настроить funnel tracking, drop-off метрики и alerting по зависанию на шагах.
- Критерий закрытия:
  - onboarding контур подтвержден проверяемой регрессией;
  - основные drop-off и stuck-step риски наблюдаемы;
  - аналитика и UX согласованы с backend state model.

**Что сделано**

Выполнено 2026-04-26.

### Новые файлы

**`apps/api/src/modules/onboarding/onboarding.service.spec.ts`** — полный regression пакет из **75 тестов** для `OnboardingService`. Все тесты зелёные (`75 passed, 75 total`, время 0.467 s).

### Структура тест-пакета

| Секция | Тестов | Что покрыто |
|--------|--------|-------------|
| `initUserBootstrap` | 4 | create, idempotency, P2002 race condition, rethrow |
| `initTenantActivation` | 3 | create, idempotency, P2002 race condition |
| `getState` | 5 | USER_BOOTSTRAP / TENANT_ACTIVATION / null / STAFF |
| `startState` | 3 | USER_BOOTSTRAP / TENANT_ACTIVATION / STAFF guard |
| `updateStep` | 9 | все переходы: PENDING→VIEWED/DONE/SKIPPED, DONE no-op, invalid transitions, not found |
| `closeState` | 3 | IN_PROGRESS→CLOSED, idempotent, COMPLETED guard |
| `reopenState` | 3 | CLOSED→IN_PROGRESS + SKIPPED reset, idempotent, COMPLETED guard |
| `completeState` | 3 | IN_PROGRESS→COMPLETED, COMPLETED guard, CLOSED guard |
| `markStepDone` | 6 | domain event, idempotency, silent no-state, auto-complete USER_BOOTSTRAP, skip if COMPLETED, TENANT_ACTIVATION |
| `bootstrap-to-tenant handoff` | 2 | setup_company → auto-complete + отдельный TENANT_ACTIVATION, idempotency |
| `access control` | 8 | STAFF null, MANAGER viewed✓/done✗/skip✗/close✗/complete✗, OWNER full, ADMIN full |
| `tenant access-state guards` | 9 | TRIAL_EXPIRED/SUSPENDED/CLOSED block writes; getState read-only с blockReason; приоритет ROLE_INSUFFICIENT; isCtaBlocked на шагах |
| `formatResponse` | 4 | progress counters, nextRecommendedStep null/VIEWED/PENDING, ctaLink/autoCompleteEvent |
| `checkStuckSteps` | 4 | event per step, count=4, empty no events, query filter |
| `observability` | 9 | все 8 событий: bootstrap_created, activation_created, step_updated (×2), state_closed, reopened, completed (×2), step_stale |

### Изменения в существующих файлах

**`apps/api/src/modules/onboarding/onboarding.service.ts`** — добавлен метод `checkStuckSteps(staleDaysThreshold = 7)`:
- Запрашивает все `IN_PROGRESS` состояния с `updatedAt < cutoff`
- Для каждого незавершённого шага (`PENDING` / `VIEWED`) эмитит JSON-событие `onboarding_step_stale` с `stateId`, `scope`, `stepKey`, `userId`, `tenantId`, `staleSince`
- Предназначен для ежедневного cron-вызова (NestJS `@Cron` или внешний scheduler)

### Критерии закрытия — статус
- ✅ Regression пакет: start/skip/reopen/complete/resume покрыты
- ✅ Handoff USER_BOOTSTRAP → TENANT_ACTIVATION подтверждён тестами
- ✅ Auto-complete шагов по domain events проверен (markStepDone + auto-complete)
- ✅ Поведение в TRIAL_EXPIRED, SUSPENDED, CLOSED проверено (read-only getState + 403 на writes)
- ✅ Funnel tracking: все 8 структурированных JSON-событий подтверждены observability-секцией
- ✅ Alerting: `checkStuckSteps` эмитит `onboarding_step_stale` для зависших шагов
