# TASK_TENANT_7 — Frontend Tenant UX, Regression и Observability

> Модуль: `02-tenant`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_TENANT_2`
  - `TASK_TENANT_3`
  - `TASK_TENANT_5`
  - `TASK_TENANT_6`
- Что нужно сделать:
  - собрать tenant picker, current tenant summary, warnings и blocked state UX;
  - показать `TRIAL_EXPIRED`, `GRACE_PERIOD`, `SUSPENDED`, `CLOSED` с понятным объяснением доступных действий;
  - покрыть regression на create/switch/isolation/access-state/closed tenant restore;
  - проверить observability: transition events, cross-tenant denials, closure jobs, stuck states.
- Критерий закрытия:
  - tenant UX предсказуем и согласован с backend policy;
  - ключевые сценарии create/switch/read-only/closed подтверждены тестами;
  - support и расследование обеспечены telemetry и audit.

---

**Что сделано (2026-04-26)**

### Frontend

**`AuthContext.tsx`** — расширен:
- добавлены интерфейсы `ActiveTenant` и `TenantSummary`;
- state `activeTenant: ActiveTenant | null` и `tenants: TenantSummary[]` синхронизируются из ответа `GET /auth/me`;
- добавлен метод `switchTenant(tenantId)` — вызывает `POST /tenants/:id/switch`, затем `checkAuth()`;
- `logout` обнуляет `activeTenant` и `tenants`.

**`components/AccessStateBanner.tsx`** — новый компонент:
- отображает баннер для состояний `TRIAL_EXPIRED` (error/красный), `GRACE_PERIOD` (warning/жёлтый), `SUSPENDED` (error/красный), `CLOSED` (error/красный);
- для нейтральных состояний возвращает `null` (баннер не рендерится);
- сообщения включают описание ситуации и доступные действия пользователя.

**`pages/CreateCompany.tsx`** — новая страница `/onboarding`:
- форма создания первой компании: `name`, `inn`, `legalName`, `taxSystem`, `country`, `currency`, `timezone`;
- валидация ИНН на frontend (pattern `^\d{10}(\d{2})?$`);
- обработка ошибки `TENANT_INN_ALREADY_EXISTS` с понятным сообщением;
- после успешного создания вызывает `checkAuth()` и редиректит на `/app`.

**`pages/TenantPicker.tsx`** — новая страница `/tenant-picker`:
- отображает доступные tenant как кнопки-карточки с бейджем статуса;
- CLOSED и недоступные tenant показываются отдельно: заблокированы, иконка замка, текст "Обратитесь в службу поддержки";
- кнопка "Добавить новую компанию" → переход на `/onboarding`;
- при переключении вызывает `switchTenant()` → `/app`.

**`App.tsx`** — обновлён:
- добавлены роуты `/onboarding` (обёрнут в `AuthenticatedOnly`) и `/tenant-picker` (обёрнут в `AuthenticatedOnly`);
- `PrivateRoute` теперь проверяет `nextRoute`: если `/onboarding` — редирект на создание компании, если `/tenant-picker` — редирект на выбор компании;
- `AuthenticatedOnly` — новый компонент: требует только авторизацию без active tenant context.

**`MainLayout.tsx`** — обновлён:
- `user?.store?.name` заменён на `activeTenant?.name` (desktop sidebar и mobile header);
- добавлен `<AccessStateBanner accessState={activeTenant.accessState} />` в начале main-content area — показывается при наличии `activeTenant`.

### Backend: Regression тесты

**`tenant.service.spec.ts`** — новый файл, 44 теста:

| Группа | Тесты |
|--------|-------|
| `createTenant` | success, preferences update, INN duplicate, audit event |
| `listTenants` | multiple tenants, empty list |
| `getCurrentTenant` | no prefs, null lastUsed, valid, no membership |
| `getTenant` | success, not found |
| `switchTenant` | success + audit, no membership, status=CLOSED, accessState=CLOSED |
| `getAccessWarnings` | TRIAL_EXPIRED, GRACE_PERIOD, SUSPENDED, ACTIVE_PAID, not found |
| `transitionAccessState` | allowed, blocked, CLOSED updates status+closedAt, not found |
| `closeTenant` | success, retention 90d, not found, already closed, not owner |
| `restoreTenant` | success, not closed, retention expired, no closure job, not owner, not found |
| `data isolation` | cross-tenant getTenant/switchTenant/getAccessWarnings заблокированы |
| `observability` | tenant_created, tenant_selected_as_active, tenant_closed, tenant_restored, tenant_access_state_changed |

Все 44 теста прошли: `Tests: 44 passed, 44 total`.

### Backend: Observability в Guards

**`ActiveTenantGuard`** — добавлен `Logger`:
- логирует `cross_tenant_access_denied` с `userId`, `tenantId` и `reason` (`NO_MEMBERSHIP` / `TENANT_CLOSED`) при строгом режиме (заголовок `X-Tenant-Id`).

**`RequireActiveTenantGuard`** — добавлен `Logger`:
- логирует `tenant_context_required` с `userId` и `path` при отсутствии active tenant context.

**`TenantWriteGuard`** — добавлен `Logger`:
- логирует `tenant_write_blocked` с `userId`, `tenantId`, `accessState` и `path` при попытке записи в заблокированном состоянии.

### Проверки
- `tsc --noEmit` → 0 ошибок (api и web)
- Jest: 44/44 tenant.service.spec тестов прошли
