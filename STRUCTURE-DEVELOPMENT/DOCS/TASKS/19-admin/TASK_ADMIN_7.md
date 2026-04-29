# TASK_ADMIN_7 — QA, Regression и Observability Admin

> Модуль: `19-admin`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_ADMIN_1`
  - `TASK_ADMIN_2`
  - `TASK_ADMIN_3`
  - `TASK_ADMIN_4`
  - `TASK_ADMIN_5`
  - `TASK_ADMIN_6`
- Что нужно сделать:
  - покрыть тестами tenant search, tenant 360 load, extend trial, set access state, restore tenant, password reset, notes;
  - проверить обязательный reason и запрет high-risk actions без него;
  - покрыть кейсы `SUPPORT_READONLY` vs `SUPPORT_ADMIN`;
  - добавить сценарии forbidden billing override и forbidden impersonation;
  - завести метрики и алерты по support actions, denied attempts, anomalous tenant access breadth и note creation.
- Критерий закрытия:
  - регрессии по support RBAC и high-risk contracts ловятся автоматически;
  - observability показывает качество и безопасность support operations;
  - QA matrix покрывает утвержденную MVP admin policy.

**Что сделано**

### 1. Observability контракт (§19) — `AdminMetricsRegistry`

Новый process-local in-memory registry [apps/api/src/modules/admin/admin.metrics.ts](../../../../apps/api/src/modules/admin/admin.metrics.ts) (по образцу `TasksMetricsRegistry` / `AnalyticsMetricsRegistry` — структурированные JSON-логи без Prometheus-зависимости, чтобы интеграция с Loki/Datadog шла через log-based metrics). Реализованы все 13 контрактных метрик §19:

- **counters**: `admin_searches`, `tenant_cards_opened`, `support_actions_started/succeeded/failed`, `reason_missing_attempts`, `notes_created`, `denied_attempts`, `support_billing_override_blocked`, `support_restore_blocked_by_retention`;
- **histograms** (sliding window 200): `tenant_card_latency_ms` (для §18 SLA p95 < 700 мс) и `support_action_duration_ms`;
- **gauges**: `tenant_access_breadth` per supportUserId (для алерта §19 «один оператор смотрит много tenant'ов»).

Зарегистрирован в `AdminModule` и интегрирован в:

- `SupportActionsService` — каждый mutating путь (`extendTrial`/`setAccessState`/`restoreTenant`/`triggerPasswordReset`/`recordNoteAdded`) инкрементит `STARTED`, в финале — `SUCCEEDED` или `FAILED` с `reason`-меткой (errorCode), записывает `support_action_duration_ms`. `BILLING_OVERRIDE_NOT_ALLOWED` и `TENANT_RETENTION_WINDOW_EXPIRED` идут в отдельные counters — это даёт алертам §15/§22 видеть, что guard'ы реально срабатывают, а не «прячутся» в общем `_failed`.
- `AdminAuthGuard` — каждый RBAC-deny инкрементит `DENIED_ATTEMPTS` параллельно с `support_security_events.admin_rbac_denied` (live-метрика для алерта в реальном времени, без необходимости агрегировать SQL).
- `TenantDirectoryController.list` — counter `ADMIN_SEARCHES` с label'ом supportUserId/role;
- `Tenant360Controller.get` — counter `TENANT_CARDS_OPENED` + observe `tenant_card_latency_ms` (start/finally вокруг 13 параллельных bounded запросов из T2).

### 2. Тестовая матрица §16 — 6 spec-файлов, 65/65 passed

| Файл | Что покрыто |
|------|------------|
| [admin.metrics.spec.ts](../../../../apps/api/src/modules/admin/admin.metrics.spec.ts) | counter increment, gauge per supportUser, p50/p95 histogram, sliding-window 200, reset, регрессионный список §19 имён метрик (тест валит сборку, если кто-то удалит метрику). |
| [support-actions.service.spec.ts](../../../../apps/api/src/modules/admin/support-actions/support-actions.service.spec.ts) | extend-trial / set-access-state / restore-tenant / trigger-password-reset / recordNoteAdded — success path, blocked path (tenant-not-found, user-not-found, billing-override, retention-window-expired), orphan-user без AuditLog, audit-write fail не валит admin action, correlation_id propagation в support_actions ↔ AuditLog, метрики STARTED/SUCCEEDED/FAILED + BILLING_OVERRIDE_BLOCKED/RESTORE_BLOCKED_BY_RETENTION/NOTES_CREATED. |
| [admin-auth.guard.spec.ts](../../../../apps/api/src/modules/admin/admin-auth/admin-auth.guard.spec.ts) | CSRF double-submit (POST без CSRF → ADMIN_CSRF_TOKEN_INVALID; GET не требует CSRF; admin-public POST всё равно проверяет CSRF), JWT validation (нет токена / невалидный → ADMIN_AUTH_REQUIRED), RBAC: SUPPORT_READONLY на mutating endpoint → FORBIDDEN_SUPPORT_ADMIN_REQUIRED + audit `admin_rbac_denied` + counter, SUPPORT_ADMIN на mutating → пропуск, SUPPORT_READONLY на read-only без `@AdminRoles` → пропуск, Bearer-fallback из Authorization. |
| [set-access-state.dto.spec.ts](../../../../apps/api/src/modules/admin/support-actions/dto/set-access-state.dto.spec.ts) | DTO whitelist `{TRIAL_ACTIVE, SUSPENDED}` — все 5 forbidden targets (`ACTIVE_PAID`/`GRACE_PERIOD`/`EARLY_ACCESS`/`CLOSED`/`TRIAL_EXPIRED`) ловятся `class-validator`'ом ДО controller'а; reason `< 10` → `MinLength`-error; sanity-check `ExtendTrialDto`/`RestoreTenantDto`/`TriggerPasswordResetDto` (≥ 10 / `< 10` / пустой). |
| [support-notes.service.spec.ts](../../../../apps/api/src/modules/admin/support-notes/support-notes.service.spec.ts) | list — публичные поля автора `{id,email,role}` без IP/UA/correlationId; tenant-not-found → ADMIN_TENANT_NOT_FOUND; create — пишет support_note + делегирует actions.recordNoteAdded; tenant-not-found на create не вызывает recordNoteAdded. |
| [forbidden-actions.spec.ts](../../../../apps/api/src/modules/admin/support-actions/forbidden-actions.spec.ts) | (T5) статический скан admin-controllers на отсутствие forbidden-токенов в `@Get/@Post/@Controller`. |

### 3. Покрытые сценарии §16 матрицы

- **Поиск tenant по имени** — covered (TenantDirectoryService через TS5/T2 + counter ADMIN_SEARCHES).
- **Поиск tenant по owner email** — covered (TS5/T2 + counter).
- **Trial extend с обязательным reason** — `support-actions.service.spec.ts` + `extend-trial.dto.spec.ts`.
- **Попытка high-risk action без reason** — DTO `MinLength(10)` ловит ДО controller'а (covered для всех 4 high-risk DTO).
- **Trigger password reset без доступа к password hash** — covered: `triggerPasswordResetBySupport` вызывается только через AuthService, который НЕ возвращает hash; spec проверяет, что support никогда не получает passwordHash ни в одном return-payload'е.
- **Добавление internal note** — `support-notes.service.spec.ts` + counter NOTES_CREATED.
- **Restore closed tenant в retention window** — covered: success path + `TENANT_RETENTION_WINDOW_EXPIRED` blocked path с отдельным counter `RESTORE_BLOCKED_BY_RETENTION`.
- **Попытка read-only роли выполнить mutating action** — `admin-auth.guard.spec.ts` (FORBIDDEN_SUPPORT_ADMIN_REQUIRED + counter DENIED_ATTEMPTS).
- **Попытка billing override, запрещённого в MVP** — двойное покрытие: DTO whitelist (`set-access-state.dto.spec.ts`) + service-level `BILLING_OVERRIDE_NOT_ALLOWED` (`support-actions.service.spec.ts`) + регрессия `forbidden-actions.spec.ts` на отсутствие endpoint'ов.
- **Forbidden impersonation** — covered регрессионным `forbidden-actions.spec.ts` (нет ни одного admin-маршрута со словами `login-as-user`, `impersonate`, `read-password-hash`, `billing-override`).

### 4. Pass-rate

```
admin/                      6 suites,  65 tests passed
admin + tenants + audit + auth   12 suites, 237 tests passed
```

Type-check `npx tsc --noEmit` по admin-модулю — без ошибок (предсуществующие ошибки в catalog/inventory/sync-runs не связаны).
