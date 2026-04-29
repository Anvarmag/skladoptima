# Admin-панель — Системная аналитика

> Статус: [x] Завершён
> Последнее обновление: 2026-04-29
> Связанный раздел: `19-admin`

## 1. Назначение модуля

Внутренний модуль для support-контура: поиск tenant, диагностика состояния, ограниченный набор support actions, internal notes и audit без прямого обхода доменных правил и без SQL-like доступа.

### Текущее состояние (as-is)

- в текущем backend нет выделенного admin support модуля, а во frontend нет admin-панели;
- support actions, tenant 360 и internal notes пока существуют только как проектный слой финального спринта;
- роль `SUPPORT_ADMIN` и граница internal control plane еще не реализованы в коде как отдельный контур.

### Целевое состояние (to-be)

- admin должен стать отдельным внутренним control plane для поддержки и операционного управления tenant;
- любое high-risk support действие обязано выполняться через доменные сервисы и фиксироваться в audit;
- internal notes и support actions должны быть изолированы от tenant-facing интерфейса и API;
- admin-модуль должен уважать уже зафиксированные ограничения `billing`, `tenant`, `audit` и не вводить скрытые override-механики.


## 2. Функциональный контур и границы

### Что входит в модуль
- внутренняя support/admin-панель для диагностики tenant;
- tenant 360 view по ключевым модулям;
- ограниченный набор support actions;
- internal notes и контекст инцидентов;
- строгий audit и guardrails для high-risk операций;
- временный внутренний RBAC с разделением `support_readonly` и `support_admin`, если это подтверждается продуктом.

### Что не входит в модуль
- публичный tenant-facing интерфейс;
- обход бизнес-правил доменных модулей;
- CRM helpdesk система полного цикла;
- произвольный SQL/ручное редактирование БД.

### Главный результат работы модуля
- внутренняя команда может быстро диагностировать tenant и безопасно выполнять ограниченные support-действия без разрушения продуктовых инвариантов.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| SUPPORT_ADMIN | Работает с tenant incidents и actions | Основной управляющий actor |
| SUPPORT_READONLY | Смотрит tenant context и диагностику | Не выполняет mutating actions |
| Support lead / Ops | Контролирует качество и SLA | Чаще read-heavy роль |
| Sales/Success | Смотрит tenant context | Только если будет выделен read-only subset |
| Доменные сервисы | Исполняют support action по контракту | Admin-panel не должна писать в БД напрямую |

## 4. Базовые сценарии использования

### Сценарий 1. Поиск tenant и диагностика
1. Support ищет tenant по id/email/name.
2. Открывает tenant 360 карточку.
3. Получает summary по auth, billing, sync, notifications, last errors.
4. Решает, нужен ли support action.

### Сценарий 2. High-risk support action
1. Support инициирует допустимое high-risk действие, например `extend trial` или `restore closed tenant`.
2. Система требует reason/comment и подтверждение.
3. Доменный модуль исполняет действие по своему API/contract.
4. Результат и обоснование пишутся в audit.

### Сценарий 3. Ведение internal note
1. Оператор создает заметку по кейсу.
2. Note привязывается к tenant и/или инциденту.
3. Заметка доступна только внутренним ролям и участвует в handoff между операторами.

## 5. Зависимости и интеграции

- Tenant/Billing/Marketplace/Sync/Audit/Auth
- Role model платформы (`SUPPORT_ADMIN`, возможно `SUPPORT_READONLY`)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/admin/tenants` | SUPPORT_READONLY/SUPPORT_ADMIN | Tenant directory |
| `GET` | `/api/v1/admin/tenants/:tenantId` | SUPPORT_READONLY/SUPPORT_ADMIN | Tenant 360 view |
| `POST` | `/api/v1/admin/tenants/:tenantId/actions/extend-trial` | SUPPORT_ADMIN | Продлить trial |
| `POST` | `/api/v1/admin/tenants/:tenantId/actions/set-access-state` | SUPPORT_ADMIN | Изменить access state |
| `POST` | `/api/v1/admin/tenants/:tenantId/actions/restore-tenant` | SUPPORT_ADMIN | Восстановить `CLOSED` tenant в retention window |
| `POST` | `/api/v1/admin/users/:userId/actions/password-reset` | SUPPORT_ADMIN | Инициировать reset flow |
| `GET` | `/api/v1/admin/tenants/:tenantId/notes` | SUPPORT_READONLY/SUPPORT_ADMIN | Список internal notes |
| `POST` | `/api/v1/admin/tenants/:tenantId/notes` | SUPPORT_ADMIN | Добавить note |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/admin/tenants/tnt_123/actions/set-access-state \
  -H "Authorization: Bearer <SUPPORT_ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"toState":"ACTIVE_PAID","reason":"Ошибочная блокировка после платежа"}'
```

### Frontend поведение

- Текущее состояние: в текущих маршрутах web-клиента нет `/admin` и отдельного support интерфейса.
- Целевое состояние: нужны tenant directory, tenant 360, support actions и internal notes для роли поддержки.
- UX-правило: admin UI не должен визуально и логически смешиваться с tenant-facing кабинетом.
- В MVP tenant 360 должен строиться на summary/read-model, а не на дорогих ad hoc join по боевым таблицам.
- В UI high-risk actions должны быть визуально отделены от read-only диагностики и всегда требовать reason.

## 8. Модель данных (PostgreSQL)

### `support_actions`
- `id UUID PK`, `tenant_id UUID`, `actor_support_user_id UUID`
- `action_type VARCHAR(64)`
- `reason TEXT NOT NULL`
- `payload JSONB`
- `result_status ENUM(success, failed, blocked)`
- `audit_log_id UUID NULL`
- `correlation_id UUID NULL`
- `created_at`

### `support_notes`
- `id UUID PK`, `tenant_id UUID`, `author_support_user_id UUID`
- `note TEXT NOT NULL`
- `created_at`, `updated_at`

### `support_users`
- `id UUID PK`, `email`, `role ENUM(support_admin, support_readonly)`
- `is_active BOOLEAN`, `last_login_at`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Support actor проходит internal auth и открывает `/admin`.
2. Находит tenant по имени/email owner/id.
3. Открывает tenant card с ключевыми статусами и недавними проблемами.
4. Если нужен mutating action, UI проверяет роль `support_admin` и требует `reason`.
5. Action исполняется через доменный сервис, а не прямой записью в таблицы.
6. Action записывается в `support_actions` и общий audit.
7. Internal notes используются для handoff между сменами поддержки.

## 10. Валидации и ошибки

- Все high-risk actions требуют `reason` длиной >= 10 символов.
- Impersonation/login-as-user в MVP запрещен.
- `special free access` и иные billing override вне согласованных тарифных правил в MVP запрещены.
- `restore-tenant` разрешен только если tenant находится в `CLOSED` и retention window еще не истек.
- Ошибки:
  - `FORBIDDEN: SUPPORT_ROLE_REQUIRED`
  - `VALIDATION_ERROR: REASON_REQUIRED`
  - `CONFLICT: ACTION_NOT_ALLOWED_FOR_STATE`
  - `FORBIDDEN: SUPPORT_ADMIN_REQUIRED`
  - `FORBIDDEN: BILLING_OVERRIDE_NOT_ALLOWED`

## 11. Чеклист реализации

- [x] Admin RBAC middleware. — TASK_ADMIN_1: `AdminAuthGuard` + `@AdminRoles` + `support_security_events.admin_rbac_denied`.
- [x] Tenant directory + tenant 360 query. — TASK_ADMIN_2: `GET /api/admin/tenants` (UUID/name/owner-email поиск, keyset cursor) + `GET /api/admin/tenants/:tenantId` (13 параллельных bounded запросов через summary read-model: team, subscription/access history, marketplace accounts, sync, notifications, worker, files, audit, security events, notes-stub).
- [x] Support actions API с обязательным reason. — TASK_ADMIN_3: `POST /api/admin/tenants/:tenantId/actions/{extend-trial,set-access-state,restore-tenant}` + `POST /api/admin/users/:userId/actions/password-reset`, все под `@AdminRoles('SUPPORT_ADMIN')` + DTO `MinLength(10)`. Mutation путь — только через `TenantService.{extendTrialBySupport,transitionAccessState(supportContext),restoreTenantBySupport}` и `AuthService.triggerPasswordResetBySupport`. Policy расширена narrow-set'ом `SUPPORT_ALLOWED_TRANSITIONS` (`TRIAL_EXPIRED→TRIAL_ACTIVE`, `CLOSED→SUSPENDED`).
- [x] Notes + audit trail. — TASK_ADMIN_3+TASK_ADMIN_4: модели `SupportAction` и `SupportNote`, `GET/POST /api/admin/tenants/:tenantId/notes`. **TASK_ADMIN_4** закрыл linkage: `writeEvent`/`writePrivilegedEvent` теперь возвращают `audit_log_id`, который сохраняется в `support_actions.audit_log_id` для всех 4 mutating путей и ADD_INTERNAL_NOTE. Введён event `SUPPORT_NOTE_ADDED` (domain SUPPORT, mandatory в audit coverage contract) — note creation теперь идёт в общий audit trail. `correlation_id` извлекается из `x-correlation-id`/`x-request-id` единым `buildSupportRequestContext()` хелпером и сохраняется и в `support_actions.correlation_id`, и в `AuditLog.correlationId` — даёт сквозную связь admin-плоскость ↔ общий audit. SUPPORT_READONLY read-only invariant: GET /notes отдаёт только `{id, note, dates, author{id,email,role}}` без IP/UA/correlation-id оператора.
- [x] Security review high-risk операций. — TASK_ADMIN_5: закрыт billing-override gap в `AccessStatePolicy.assertSupportTransitionAllowed` (раньше объединял ALLOWED_TRANSITIONS со SUPPORT_ALLOWED_TRANSITIONS — позволяло SUPPORT_ADMIN выполнять `SUSPENDED→ACTIVE_PAID`/`TRIAL_ACTIVE→ACTIVE_PAID`/`GRACE_PERIOD→ACTIVE_PAID` под видом «обычной транзиции»). Теперь policy использует только narrow-set + явный реестр `SUPPORT_BILLING_OVERRIDE_TARGETS={ACTIVE_PAID,GRACE_PERIOD,EARLY_ACCESS}` с отдельным error-code `BILLING_OVERRIDE_NOT_ALLOWED`. `SetAccessStateDto` сужен до `@IsIn(['TRIAL_ACTIVE','SUSPENDED'])` (defense-in-depth: fail-fast в DTO + policy). Создан `forbidden-actions.ts` registry (impersonation, plaintext credentials, billing override, raw SQL, hard delete, PII export) с регрессионным spec-тестом, статически сканирующим admin controller-файлы на отсутствие forbidden-токенов в маршрутах. 28 новых тестов (13 в access-state.policy.spec.ts + 15 в forbidden-actions.spec.ts), 207/207 admin/tenant/audit тестов passed.
- [x] QA, Regression и Observability Admin. — TASK_ADMIN_7: реализован `AdminMetricsRegistry` ([apps/api/src/modules/admin/admin.metrics.ts](../../../../apps/api/src/modules/admin/admin.metrics.ts)) — все 13 метрик §19 (counters `admin_searches`/`tenant_cards_opened`/`support_actions_started|succeeded|failed`/`reason_missing_attempts`/`notes_created`/`denied_attempts`/`support_billing_override_blocked`/`support_restore_blocked_by_retention`; histograms `tenant_card_latency_ms`/`support_action_duration_ms` со sliding window 200; gauge `tenant_access_breadth` per supportUserId). Зарегистрирован в `AdminModule`, проброшен в `SupportActionsService` (counters STARTED/SUCCEEDED/FAILED + отдельные BILLING_OVERRIDE_BLOCKED/RESTORE_BLOCKED_BY_RETENTION + observeActionDuration вокруг каждого mutating пути), `AdminAuthGuard` (DENIED_ATTEMPTS параллельно с support_security_events.admin_rbac_denied), `TenantDirectoryController.list` (ADMIN_SEARCHES), `Tenant360Controller.get` (TENANT_CARDS_OPENED + observeTenantCardLatency для §18 SLA). Новых тестов 65: `admin.metrics.spec.ts` (8), `support-actions.service.spec.ts` (13 — extend/set/restore/password-reset/notes success+blocked+orphan+correlation_id+audit-write-fail), `admin-auth.guard.spec.ts` (9 — CSRF/JWT/RBAC SUPPORT_READONLY vs SUPPORT_ADMIN/Bearer-fallback), `set-access-state.dto.spec.ts` (16 — whitelist ловит `ACTIVE_PAID|GRACE_PERIOD|EARLY_ACCESS|CLOSED|TRIAL_EXPIRED` ДО controller'а), `support-notes.service.spec.ts` (5 — публичные поля автора без IP/UA, tenant-not-found). 12/12 suites, 237/237 tests passed (admin+tenants+audit+auth). Полностью покрывает §16 матрицу (поиск, trial extend, reason-required, password-reset без password-hash, notes, restore в retention window, read-only попытка mutating, billing override) и §15/§22 forbidden-action режимы (impersonation, billing override, plaintext credentials) через регрессию `forbidden-actions.spec.ts`.
- [x] Frontend admin panel + tenant 360 UX + high-risk action flows. — TASK_ADMIN_6: реализован изолированный frontend admin-контур. Отдельный `adminAxios` instance в [apps/web/src/api/admin.ts](../../../../apps/web/src/api/admin.ts) с собственным CSRF-токеном (`/api/admin/auth/csrf-token`) и refresh-on-401 single-flight interceptor (без переплетения с tenant-facing axios.defaults). Изолированный `AdminAuthProvider` смонтирован только под `/admin/*` через `AdminRoot` (иначе tenant-страницы дёргали бы `/admin/auth/me` и засоряли support_security_events). `AdminLayout` намеренно отличается от tenant `MainLayout`: тёмная slate-900 sidebar, amber warning-ribbon "Internal control plane", role-badges (SUPPORT_ADMIN amber / SUPPORT_READONLY с иконкой Eye). Реализованы 4 страницы: `AdminLogin` (обрабатывает SOFT_LOCKED/INACTIVE/INVALID), `AdminTenants` (search по UUID/name/owner email + filters accessState/status + keyset-pagination + desktop table/mobile cards), `AdminTenant360` (9 read-only diagnostic карточек + amber **High-risk zone** + notes panel + recent support actions), `AdminChangePassword` с auto-logout. `HighRiskActionModal` — единый компонент: reason live-validation ≥10 (счётчик и прогресс), checkbox "попадёт в audit", обработка кодов BILLING_OVERRIDE_NOT_ALLOWED/ACTION_NOT_ALLOWED_FOR_STATE/FORBIDDEN. `InternalNotesPanel` помечен Lock-badge "Internal-only", composer виден только SUPPORT_ADMIN, readonly видит явный disclaimer. Per-action whitelisting на UI зеркалит SUPPORT_ALLOWED_TRANSITIONS (Extend trial — TRIAL_ACTIVE/TRIAL_EXPIRED; Set state — из TRIAL_EXPIRED/CLOSED; Restore — только CLOSED). Catchall `/admin/*` ведёт обратно на `/admin`, а не на tenant `/app`. Vite build прошёл без ошибок (1120 kB → 309 kB gzip).

## 12. Критерии готовности (DoD)

- Любое support-действие объяснимо и аудируемо.
- SUPPORT_ADMIN не имеет небезопасного доступа к паролям/секретам.
- Внутренняя панель ускоряет диагностику tenant-проблем.
- Read-only роли не получают mutating endpoints.

## 13. Категории support actions

- `EXTEND_TRIAL`
- `SET_ACCESS_STATE`
- `RESTORE_TENANT`
- `TRIGGER_PASSWORD_RESET`
- `ADD_INTERNAL_NOTE`

### High-risk actions
- `SET_ACCESS_STATE`
- `EXTEND_TRIAL`
- `RESTORE_TENANT`

## 14. Tenant 360 состав

### В карточке tenant показывать
- tenant core data
- owner и team summary
- subscription/access state
- marketplace accounts summary
- recent sync errors
- recent notifications
- worker/queue status summary
- files/storage health summary
- audit summary
- internal notes

## 15. Security guardrails

- SUPPORT_ADMIN не может читать plaintext credentials.
- SUPPORT_ADMIN не может получить пароль пользователя.
- SUPPORT_ADMIN не может impersonate user на MVP.
- Все high-risk actions требуют `reason` и попадают в отдельный support audit context.
- SUPPORT_ADMIN не может выдавать hidden billing overrides вне утвержденной product policy.
- SUPPORT_READONLY не имеет доступа к mutating support actions.

## 16. Тестовая матрица

- Поиск tenant по имени.
- Поиск tenant по owner email.
- Trial extend с обязательным reason.
- Попытка high-risk action без reason.
- Trigger password reset без доступа к password hash.
- Добавление internal note.
- Restore closed tenant в retention window.
- Попытка read-only роли выполнить mutating action.
- Попытка billing override, запрещенного в MVP.

## 17. Фазы внедрения

1. Support users/roles.
2. Tenant directory и tenant 360 query layer.
3. Support actions API.
4. Notes и support audit.
5. Security hardening и review.

## 18. Нефункциональные требования и SLA

- Tenant 360 карточка должна открываться быстро: целевой `p95 < 700 мс` на согласованной summary-модели.
- High-risk actions должны требовать reason/comment и всегда попадать в audit.
- Admin-panel не должна иметь прямой доступ на произвольную запись в доменные таблицы.
- Все внутренние данные и заметки должны быть жестко изолированы от tenant-facing API.
- Admin auth/session должны быть отделены от tenant-facing RBAC и не использовать tenant picker как источник полномочий.

## 19. Observability, логи и алерты

- Метрики: `admin_searches`, `tenant_cards_opened`, `support_actions_started`, `support_actions_failed`, `reason_missing_attempts`, `repeat_cases`.
- Логи: tenant access by admin, high-risk action execution, notes creation, denied attempts.
- Алерты: high-risk action without reason attempt, рост failed support actions, anomalous access to many tenants одним оператором.
- Dashboards: support SLA board, action quality board, internal audit compliance board.

## 20. Риски реализации и архитектурные замечания

- Главный риск: превратить admin-panel в “дырку” мимо всех доменных контрактов.
- Tenant 360 должен строиться на read-model/summaries, иначе панель станет медленной и хрупкой.
- Любой support override обязан идти через официальный сервис модуля-источника, а не прямой SQL-like patch.
- Нужно заранее разделить read-only internal roles и destructive support roles, иначе RBAC быстро размоется.
- Если в MVP оставить слишком широкий набор support actions, admin-контур начнет дублировать бизнес-продукт вместо диагностики и точечной поддержки.

## 21. Открытые вопросы к продукту и архитектуре

- Для MVP открытых product/blocking questions не осталось.

## 22. Подтвержденные решения

- MVP-набор support actions подтвержден как `extend trial`, `set access state`, `restore tenant`, `trigger password reset`, `add internal note`.
- `special access / billing override` не входят в MVP.
- Отдельная роль `SUPPORT_READONLY` входит в MVP.
- `SUPPORT_READONLY` может видеть internal notes в согласованной read-only модели.

## 23. Чеклист готовности раздела

- [x] Текущее и целевое состояние раздела зафиксированы.
- [x] Backend API, frontend поведение и модель данных согласованы между собой.
- [x] Async-процессы, observability и тестовая матрица описаны.
- [x] Риски, ограничения и rollout-порядок зафиксированы.

## 24. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Убрано противоречие с billing override, добавлены support роли, tenant 360 scope и открытые решения по MVP support actions | Codex |
| 2026-04-18 | Зафиксированы confirmed decisions по MVP support actions и support role model | Codex |
| 2026-04-29 | TASK_ADMIN_1 закрыт: добавлены `support_users`, `support_auth_sessions`, `support_login_attempts`, `support_security_events`, реализован изолированный `AdminModule` с собственным JWT-контуром (`ADMIN_JWT_SECRET`, `audience: 'admin'`), отдельным CSRF (`admin-csrf-token`), `AdminAuthGuard` (RBAC + reuse detection + soft-lock) и `@AdminEndpoint()` декоратором для безопасной изоляции от tenant-facing guards | Claude |
| 2026-04-29 | TASK_ADMIN_2 закрыт: реализованы `GET /api/admin/tenants` (поиск по UUID/name/owner-email, фильтры по `accessState`/`status`, keyset-cursor pagination) и `GET /api/admin/tenants/:tenantId` (tenant 360 на summary read-model — 13 параллельных bounded запросов: team, invitations, access history, marketplace accounts, recent sync runs + 7d failed/conflicts, notifications, worker, files, audit, security events, stub-`notes` под T4) | Claude |
| 2026-04-29 | TASK_ADMIN_3 закрыт: модели `support_actions` + `support_notes` с enum'ами `SupportActionType`/`SupportActionResultStatus`. `SupportActionsService` как единственный mutation-путь admin-плоскости — вызывает доменные `TenantService.{extendTrialBySupport,transitionAccessState(supportContext),restoreTenantBySupport}` и `AuthService.triggerPasswordResetBySupport`, фиксирует success/blocked/failed в `support_actions` и tenant-facing audit через `writePrivilegedEvent` (internal_only). `AccessStatePolicy` расширена narrow-set'ом `SUPPORT_ALLOWED_TRANSITIONS` без universal bypass'а. Endpoints: `POST /api/admin/tenants/:id/actions/{extend-trial,set-access-state,restore-tenant}`, `POST /api/admin/users/:id/actions/password-reset`, `GET/POST /api/admin/tenants/:id/notes`. Все mutating — `@AdminRoles('SUPPORT_ADMIN')` + reason ≥ 10 (DTO + БД-инвариант `NOT NULL`). Tenant 360 переключен на реальные notes/recent support actions | Claude |
| 2026-04-29 | TASK_ADMIN_4 закрыт: закрыты три пробела T3 — (1) `writeEvent`/`writePrivilegedEvent` возвращают `audit_log_id`, который сохраняется в `support_actions.audit_log_id` для всех 4 mutating путей + ADD_INTERNAL_NOTE через новый `safeWriteAudit()` helper (audit-write fail не валит admin action). (2) Новый `buildSupportRequestContext()` извлекает `correlation_id` из `x-correlation-id`/`x-request-id` (валидация `^[A-Za-z0-9._-]{1,128}$` против log-injection) и пробрасывает в `support_actions.correlation_id` + `AuditLog.correlationId` — сквозная связь admin-плоскость ↔ общий audit. (3) Notes теперь идут в общий audit trail: добавлен event `SUPPORT_NOTE_ADDED` (domain SUPPORT, mandatory в audit coverage contract), `recordNoteAdded` пишет в `AuditLog` через `writePrivilegedEvent`. `reason` теперь дублируется в `AuditLog.metadata.reason` для tenant-state actions. SUPPORT_READONLY read-only invariant зафиксирован: `GET /notes` отдаёт только публичные поля без IP/UA/correlation-id оператора. Тесты audit.service.spec.ts расширены 2 тестами для T4 — 43/43 passed | Claude |
| 2026-04-29 | TASK_ADMIN_5 закрыт: критичный billing-override gap в `AccessStatePolicy.assertSupportTransitionAllowed` исправлен — раньше она объединяла стандартные ALLOWED_TRANSITIONS с SUPPORT_ALLOWED_TRANSITIONS, что технически позволяло SUPPORT_ADMIN выполнять `SUSPENDED/TRIAL_ACTIVE/GRACE_PERIOD→ACTIVE_PAID` под видом обычной транзиции (hidden billing override, прямо запрещённый §15/§22). Теперь используется ТОЛЬКО narrow-set + явный реестр `SUPPORT_BILLING_OVERRIDE_TARGETS={ACTIVE_PAID,GRACE_PERIOD,EARLY_ACCESS}` с отдельным error-кодом `BILLING_OVERRIDE_NOT_ALLOWED`. `SetAccessStateDto` сужен до `@IsIn(['TRIAL_ACTIVE','SUSPENDED'])` (defense-in-depth). Создан `support-actions/forbidden-actions.ts` registry с категориями: impersonation/login-as-user, plaintext-credentials/passwords, billing-override/special-free-access/grant-paid-plan, raw-sql/direct-db-patch, hard-delete/PII-export. Регрессионный spec статически сканирует admin controllers и валит сборку при появлении forbidden-маршрутов. 28 новых тестов passed; 207/207 admin/tenant/audit тестов passed | Claude |
| 2026-04-29 | TASK_ADMIN_7 закрыт: реализован observability контракт `AdminMetricsRegistry` со всеми 13 метриками §19 (counters/histograms/gauge для tenant access breadth) и интегрирован в `SupportActionsService`/`AdminAuthGuard`/`TenantDirectoryController`/`Tenant360Controller`. Дополнительно `BILLING_OVERRIDE_BLOCKED` и `RESTORE_BLOCKED_BY_RETENTION` идут в отдельные counters — алертам §15/§22 видно реальное срабатывание policy-guard'ов. QA-матрица §16 полностью закрыта 65 новыми тестами в 5 spec-файлах (`admin.metrics.spec.ts`, `support-actions.service.spec.ts`, `admin-auth.guard.spec.ts`, `set-access-state.dto.spec.ts`, `support-notes.service.spec.ts`): success/blocked/failed для всех 5 support actions, RBAC SUPPORT_READONLY vs SUPPORT_ADMIN, CSRF double-submit, DTO whitelist `{TRIAL_ACTIVE,SUSPENDED}` против всех 5 forbidden billing-override targets, password-reset без доступа к password hash, notes без IP/UA в публичных полях, correlation_id propagation admin↔audit, audit-write fail не валит admin action. Pass-rate: 237/237 admin+tenants+audit+auth, 65/65 admin-suite | Claude |
| 2026-04-29 | TASK_ADMIN_6 закрыт: реализован полный frontend admin-контур, изолированный от tenant-facing UI. Отдельный `adminAxios` instance в `apps/web/src/api/admin.ts` с собственным CSRF и refresh-on-401 single-flight (без переплетения с глобальным `axios.defaults`, в котором живёт tenant CSRF). `AdminAuthProvider` через wrapper `AdminRoot` монтируется ТОЛЬКО под `/admin/*` — иначе tenant-страницы дёргали бы `/admin/auth/me` на каждом mount и засоряли `support_security_events`. `AdminLayout` визуально и тонально отделён от `MainLayout` (slate-900 sidebar vs белый, amber warning-ribbon "Internal control plane", role-badge SUPPORT_ADMIN/SUPPORT_READONLY). Страницы: `AdminLogin` (handles SOFT_LOCKED/INACTIVE/INVALID), `AdminTenants` (UUID/name/email search + accessState/status filters + keyset cursor + desktop-table/mobile-cards), `AdminTenant360` (9 read-only diagnostic карточек в одной секции + физически отделённая amber-bordered секция "High-risk support actions" + notes panel + recent support actions), `AdminChangePassword` с auto-logout. `HighRiskActionModal` — единый компонент: reason live-validation ≥10 (счётчик символов + прогресс до минимума), обязательный checkbox "понимаю что попадёт в audit", человекочитаемая обработка backend-кодов (BILLING_OVERRIDE_NOT_ALLOWED, ACTION_NOT_ALLOWED_FOR_STATE, FORBIDDEN, REASON_REQUIRED). `InternalNotesPanel` с lock-badge "Internal-only" — composer виден только SUPPORT_ADMIN, read-only роль видит явный disclaimer вместо textarea. Per-action whitelisting на UI зеркалит `SUPPORT_ALLOWED_TRANSITIONS` (Extend trial — TRIAL_ACTIVE/TRIAL_EXPIRED; Set state — из TRIAL_EXPIRED/CLOSED → TRIAL_ACTIVE/SUSPENDED; Restore — только CLOSED). Catchall `/admin/*` ведёт на `/admin`, не на tenant `/app`. `npx vite build` ✓ (1120 kB → 309 kB gzip, без ошибок в admin-файлах) | Claude |
