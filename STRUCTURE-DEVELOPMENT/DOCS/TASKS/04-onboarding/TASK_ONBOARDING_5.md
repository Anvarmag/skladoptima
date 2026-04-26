# TASK_ONBOARDING_5 — Tenant Access-State Guards и Role-Aware Availability

> Модуль: `04-onboarding`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_ONBOARDING_2`
  - `TASK_ONBOARDING_3`
  - `TASK_ONBOARDING_4`
  - согласованы `02-tenant` и `03-team`
- Что нужно сделать:
  - учитывать tenant `AccessState` при доступности шагов и CTA;
  - при `TRIAL_EXPIRED` оставлять onboarding доступным в read-only виде без write-oriented CTA;
  - при `SUSPENDED` и `CLOSED` вести только в billing/support и не открывать недоступные flows;
  - сохранить единый onboarding для всех ролей, но реальную доступность CTA вычислять по role/context policy;
  - возвращать из backend явный blocked/read-only state для шага.
- Критерий закрытия:
  - onboarding не подсказывает запрещенные действия;
  - `ADMIN/MANAGER` видят тот же flow, но без ложных CTA;
  - tenant-state policy и onboarding не конфликтуют.

**Что сделано**

Реализованы access-state guards и role-aware availability в `OnboardingService`. Завершено 2026-04-26.

### Изменения в `apps/api/src/modules/onboarding/onboarding.service.ts`

**1. Тип `TenantAccessContext`** (объявлен вне класса)

```typescript
type TenantAccessContext = { accessState: string; userRole: string };
```

**2. Приватный хелпер `getTenantAccessContext(userId, tenantId)`**

Параллельный запрос к БД: fetchit `tenant.accessState` и `membership.role` через `Promise.all`. Если tenant или membership не найдены — fallback на `ACTIVE_PAID` / `OWNER` (защита от edge cases при корректной инициализации).

**3. Приватный метод `computeBlockReason(ctx?)`**

Реализует приоритет блокировок из аналитики §9:
- `ROLE_INSUFFICIENT` — если `userRole === 'MANAGER'` (приоритет выше AccessState)
- `TRIAL_EXPIRED` — если `accessState === 'TRIAL_EXPIRED'`
- `TENANT_SUSPENDED` — если `accessState === 'SUSPENDED'`
- `TENANT_CLOSED` — если `accessState === 'CLOSED'`
- `null` — для USER_BOOTSTRAP (ctx не передан) и для OWNER/ADMIN с разрешёнными состояниями

**4. Приватный метод `assertTenantWriteAllowed(ctx, operation)`**

Guard для write-операций, принимает операцию: `'step_view' | 'step_action' | 'state_change'`:
- STAFF → всегда `403 ONBOARDING_FORBIDDEN`
- AccessState в `[TRIAL_EXPIRED, SUSPENDED, CLOSED]` → `403 ONBOARDING_FORBIDDEN`
- MANAGER + операция не `step_view` → `403 ONBOARDING_FORBIDDEN`

**5. Обновлён `formatResponse(state, ctx?)`**

Убраны заглушки `isCtaBlocked: false`, `isBlocked: false`, `blockReason: null`. Теперь:
- `blockReason = computeBlockReason(ctx)`
- `isCtaBlocked = blockReason !== null` — одинаково для всех шагов (если блокировка есть — она на весь онбординг)
- `isBlocked = isCtaBlocked` — синхронизировано с логикой шагов

**6. Обновлён `getState()` и `startState()`**

При `activeTenantId !== null`:
- Вызывается `getTenantAccessContext()`
- STAFF получает `{ state: null }` — онбординг для них не существует
- Остальные получают state с `formatResponse(state, ctx)`

**7. Обновлены write-методы**

Guard `assertTenantWriteAllowed` добавлен в начало при `activeTenantId !== null`:
- `updateStep()` — операция `step_view` для `'viewed'`, иначе `step_action`
- `closeState()` — операция `state_change`
- `reopenState()` — операция `state_change`
- `completeState()` — операция `state_change`

USER_BOOTSTRAP (нет tenant) — guards не применяются, пользователь всегда может управлять своим онбордингом.

### Критерии закрытия — статус

- ✅ Онбординг не подсказывает запрещённые действия: `isCtaBlocked: true` при TRIAL_EXPIRED/SUSPENDED/CLOSED/MANAGER
- ✅ ADMIN/MANAGER видят тот же flow, но MANAGER получает `blockReason: 'ROLE_INSUFFICIENT'` и `isCtaBlocked: true`
- ✅ Tenant-state policy и onboarding не конфликтуют: write-операции в заблокированных состояниях возвращают `403 ONBOARDING_FORBIDDEN`
- ✅ TypeScript компиляция без ошибок
