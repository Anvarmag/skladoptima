# TASK_ONBOARDING_2 — State API, Step Updates, Close, Reopen, Complete

> Модуль: `04-onboarding`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ONBOARDING_1`
- Что нужно сделать:
  - реализовать `GET /onboarding/state`, `POST /start`, `PATCH /steps/:stepKey`, `POST /close`, `POST /reopen`, `POST /complete`;
  - сделать update шагов идемпотентным для повторных кликов и параллельных вкладок;
  - поддержать статусы `pending`, `viewed`, `done`, `skipped`;
  - не разрешать `complete` без стартованного onboarding state;
  - сохранять прогресс консистентно между сессиями.
- Критерий закрытия:
  - state API покрывает полный lifecycle onboarding;
  - skip/reopen/complete работают предсказуемо;
  - backend остается единственным источником истины по прогрессу.

**Что сделано**

### DTO

`dto/update-step.dto.ts` — валидация тела `PATCH /steps/:stepKey`:
- `status: 'done' | 'skipped' | 'viewed'` — строго через `@IsIn`

### `OnboardingService` — новые методы

**Scope resolution** (приватный хелпер `findState` / `findStateOrThrow`):
- `activeTenantId` задан → ищем TENANT_ACTIVATION по `tenantId`
- `activeTenantId = null` → ищем USER_BOOTSTRAP по `userId`
- Фронтенд никогда не передаёт scope — только контекст запроса

**`getState(userId, activeTenantId)`** — возвращает `{ state: <response> | null }`:
- Всегда 200, тело `{ state: null }` когда запись не найдена

**`startState(userId, activeTenantId)`** — делегирует к `initUserBootstrap` / `initTenantActivation`, возвращает отформатированный state

**`updateStep(userId, activeTenantId, stepKey, newStatus)`**:
- Валидирует что stepKey есть в каталоге текущей версии → `ONBOARDING_STEP_NOT_FOUND`
- Одинаковый статус → no-op (идемпотентный)
- `DONE → *` → `ONBOARDING_INVALID_TRANSITION`
- `SKIPPED → *` → `ONBOARDING_INVALID_TRANSITION` (прямые переходы запрещены, нужен reopen)
- Записывает timestamps: `viewedAt` / `completedAt` / `skippedAt`
- При `VIEWED` обновляет `lastStepKey` в state (для resume)
- Upsert через `onboardingStateId_stepKey` — атомарная защита от race condition

**`closeState`** — `IN_PROGRESS → CLOSED`, записывает `closedAt`; идемпотентен (CLOSED → CLOSED = no-op); COMPLETED → `ONBOARDING_WRONG_STATE`

**`reopenState`** — `CLOSED → IN_PROGRESS` + `updateMany` SKIPPED → PENDING; COMPLETED → `ONBOARDING_ALREADY_COMPLETED`; IN_PROGRESS → no-op

**`completeState`** — `IN_PROGRESS → COMPLETED`, записывает `completedAt`; CLOSED → `ONBOARDING_WRONG_STATE`; COMPLETED → `ONBOARDING_WRONG_STATE`

**Приватный `formatResponse(state)`** — объединяет каталог шагов (порядок, ctaLink, autoCompleteEvent) с DB-прогрессом. Вычисляет:
- `progress: { total, done, skipped }`
- `nextRecommendedStep` — первый шаг в статусе PENDING или VIEWED по `order`
- `isBlocked: false`, `blockReason: null` — заглушка для T4-05

Все state-меняющие методы логируют структурированное событие (onboarding_state_closed / completed / reopened, onboarding_step_updated).

### `OnboardingController`

6 endpoints реализованы через `req.user.id` + `req.activeTenantId`:
```
GET  /onboarding/state
POST /onboarding/start
PATCH /onboarding/steps/:stepKey
POST /onboarding/close
POST /onboarding/reopen
POST /onboarding/complete
```

ActiveTenantGuard работает в штатном режиме — scope определяется автоматически, `@SkipTenantGuard` не используется.

### TypeScript

`tsc --noEmit` — 0 ошибок.
