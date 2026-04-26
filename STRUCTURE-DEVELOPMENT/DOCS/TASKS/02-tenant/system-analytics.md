# Мультитенантность — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `02-tenant`

## 1. Назначение модуля

Модуль отвечает за tenant как за основной business scope системы: создание компании, хранение базовых настроек, переключение активного контекста, изоляцию данных и lifecycle доступа через `AccessState`.

### Текущее состояние (as-is)

- в текущем рабочем дереве присутствует только слой документации, реализованного tenant backend/frontend в репозитории не зафиксировано;
- бизнес-требования фиксируют базовую модель tenant, но нет системного контракта на `AccessState`, data isolation и взаимодействие с membership/auth/billing;
- `active tenant`, `last used tenant`, создание компании и закрытие доступа пока описаны на уровне intent, а не как единая policy-модель.

### Целевое состояние (to-be)

- tenant должен стать отдельным доменным модулем с четкой моделью `tenant core + settings + access state`;
- любой tenant-scoped запрос должен выполняться только в контексте валидного active tenant и membership;
- `AccessState` должен меняться через централизованный policy layer, а не через произвольные изменения полей из разных модулей.

## 2. Функциональный контур и границы

### Что входит в модуль

- создание tenant после login;
- хранение tenant core и базовых настроек компании;
- поддержка активного tenant-контекста пользователя;
- строгая tenant isolation для всех tenant-scoped данных;
- lifecycle `AccessState` и его применение к доступу;
- закрытие tenant и retention lifecycle;
- read-model для tenant selector и tenant summary.

### Что не входит в модуль

- регистрация пользователя и управление credential;
- детальная role/permission модель внутри tenant;
- платежная логика, расчеты trial и payment provider;
- invite/team management как отдельный модуль;
- полный legal/offboarding workflow удаления данных beyond agreed retention policy.

### Главный результат работы модуля

- система знает, к какому tenant относится каждый бизнес-объект, кто имеет право работать в этом tenant и в каком состоянии доступа находится компания.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| User without tenant | Создает первую компанию | Должен быть аутентифицирован |
| Primary Owner | Просматривает и редактирует базовые настройки tenant | На MVP единственный полноценный управляющий actor |
| Member with access to multiple tenants | Переключает активный tenant | Не может обходить membership policy |
| Billing service | Инициирует часть переходов `AccessState` | Не должен менять tenant settings |
| SUPPORT_ADMIN | Выполняет служебные access-state actions через admin layer | Не пишет в tenant таблицы напрямую |
| Tenant policy service | Проверяет tenant scope, access state и membership | Центральный guard слой |

## 4. Базовые сценарии использования

### Сценарий 1. Создание первого tenant

1. Аутентифицированный пользователь без tenant попадает в onboarding.
2. Отправляет форму создания компании.
3. Backend валидирует обязательные поля и уникальность ИНН.
4. Создаются `tenant`, `tenant_settings`, membership создателя с ролью `PRIMARY_OWNER`.
5. Tenant получает `AccessState=TRIAL_ACTIVE`.
6. Новый tenant становится active tenant контекстом пользователя.

### Сценарий 2. Работа пользователя с несколькими tenant

1. Пользователь делает login.
2. Auth bootstrap получает memberships и `last_used_tenant_id`.
3. Если `last_used_tenant_id` валиден и доступен, он выбирается автоматически.
4. Иначе показывается tenant picker.
5. При ручном переключении контекст tenant обновляется серверно и используется в последующих запросах.

### Сценарий 3. Изменение AccessState

1. Billing scheduler или support action инициирует переход состояния.
2. Tenant policy layer проверяет допустимость transition.
3. Access state обновляется транзакционно с записью event/audit.
4. Все downstream guards начинают учитывать новое состояние tenant.

### Сценарий 4. Закрытие tenant и retention

1. Tenant переводится в `CLOSED` внутренним flow.
2. Пользовательский доступ к tenant прекращается.
3. Данные остаются в retention window.
4. После retention запускается controlled archive/delete flow по отдельной policy.

## 5. Зависимости и интеграции

- `01-auth`: active tenant context, last used tenant, post-login routing;
- `03-team`: memberships и правила owner/members access;
- `04-onboarding`: entrypoint пользователя без tenant;
- `13-billing`: trial/subscription -> `AccessState` mapping;
- `16-audit`: tenant lifecycle, settings changes, state transitions;
- `19-admin`: support-driven access-state override.

## 6. Доменная модель и состояния

### `tenant.status`

- `ACTIVE`
- `CLOSED`

### `tenant_access_state`

- `EARLY_ACCESS`
- `TRIAL_ACTIVE`
- `TRIAL_EXPIRED`
- `ACTIVE_PAID`
- `GRACE_PERIOD`
- `SUSPENDED`
- `CLOSED`

### `membership.status` в tenant-контексте

- `PENDING`
- `ACTIVE`
- `REVOKED`
- `LEFT`

### Ключевые принципы

- `tenant_access_state` не равен `membership.status` и не равен `user.status`;
- любой бизнес-объект tenant-scoped обязан иметь `tenant_id`;
- tenant selector показывает только tenant с membership пользователя, но additional guard обязан жить на backend;
- `CLOSED` как access state и `CLOSED` как итоговый tenant lifecycle должны быть синхронизированы, чтобы не было “полузакрытого” tenant.

## 7. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/tenants` | User | Создать tenant |
| `GET` | `/api/v1/tenants` | User | Список доступных tenant пользователя |
| `GET` | `/api/v1/tenants/current` | User | Текущий active tenant summary |
| `GET` | `/api/v1/tenants/:tenantId` | User(scope) | Карточка tenant |
| `PATCH` | `/api/v1/tenants/:tenantId/settings` | Primary Owner | Обновить базовые настройки |
| `GET` | `/api/v1/tenants/:tenantId/access-state` | Primary Owner/Admin(scope) | Текущий access state |
| `POST` | `/api/v1/tenants/:tenantId/switch` | User(scope) | Переключить active tenant |
| `GET` | `/api/v1/tenants/:tenantId/access-warnings` | User(scope) | Предупреждения по trial/grace/suspension |

### Internal-only endpoints

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/internal/tenants/:tenantId/access-state-transitions` | Internal | Перевод `AccessState` по policy |
| `POST` | `/api/v1/internal/tenants/:tenantId/close` | Internal/Admin | Перевод tenant в `CLOSED` |

## 8. Примеры вызова API

```bash
curl -X POST /api/v1/tenants \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"ООО Ромашка","inn":"7701234567","taxSystem":"USN","country":"RU","currency":"RUB","timezone":"Europe/Moscow"}'
```

```json
{
  "tenantId": "tnt_...",
  "accessState": "TRIAL_ACTIVE",
  "activeTenantSelected": true
}
```

```bash
curl -X POST /api/v1/tenants/tnt_123/switch \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "tenantId": "tnt_123",
  "activeTenant": true
}
```

### Frontend поведение

- после login приложение не должно само угадывать tenant только из local storage, а должно опираться на backend bootstrap;
- пользователь без tenant получает onboarding/create-company CTA;
- tenant picker показывается только если автовыбор невозможен;
- при `TRIAL_EXPIRED`, `GRACE_PERIOD`, `SUSPENDED`, `CLOSED` UI должен показывать не только badge, но и объяснение доступных/запрещенных действий.
- `CLOSED` tenant остается видимым в tenant picker/history как недоступный, вход внутрь запрещен, рядом показывается сообщение о закрытии и CTA "обратитесь в поддержку".

## 9. Модель данных (PostgreSQL)

### `tenants`

- `id UUID PK`
- `name VARCHAR(255) NOT NULL`
- `inn VARCHAR(32) NOT NULL UNIQUE`
- `status ENUM(active, closed) NOT NULL DEFAULT 'active'`
- `access_state ENUM(early_access, trial_active, trial_expired, active_paid, grace_period, suspended, closed) NOT NULL`
- `primary_owner_user_id UUID NOT NULL`
- `created_at`, `updated_at`
- `closed_at TIMESTAMPTZ NULL`

### `tenant_settings`

- `tenant_id UUID PK FK tenants(id)`
- `tax_system ENUM(usn, osno, ip_without_vat) NOT NULL`
- `country VARCHAR(2) NOT NULL`
- `currency VARCHAR(3) NOT NULL`
- `timezone VARCHAR(64) NOT NULL`
- `legal_name VARCHAR(255) NULL`
- `created_at`, `updated_at`

### `tenant_access_state_events`

- `id UUID PK`
- `tenant_id UUID FK`
- `from_state ENUM(...) NULL`
- `to_state ENUM(...) NOT NULL`
- `reason_code VARCHAR(64) NOT NULL`
- `reason_details JSONB NULL`
- `actor_type ENUM(system, billing, support, user) NOT NULL`
- `actor_id UUID NULL`
- `created_at TIMESTAMPTZ NOT NULL`

### `tenant_closure_jobs`

- `id UUID PK`
- `tenant_id UUID UNIQUE`
- `status ENUM(pending, processing, archived, deleted, failed) NOT NULL`
- `scheduled_for TIMESTAMPTZ NOT NULL`
- `processed_at TIMESTAMPTZ NULL`
- `failure_reason TEXT NULL`
- `created_at`, `updated_at`

### Используемые повторно сущности

- `memberships` для доступа пользователя к tenant;
- `user_preferences.last_used_tenant_id` для выбора активного tenant;
- `subscriptions` из billing для источника commercial lifecycle.

## 10. Контракт data isolation

### Обязательные инварианты

- все tenant-scoped таблицы содержат `tenant_id`;
- любой write/read endpoint обязан брать tenant context из session/token, а не из доверенного body/query без проверки membership;
- join между tenant-scoped таблицами всегда включает `tenant_id`, а не только surrogate key;
- фоновые jobs и workers обязаны явно принимать `tenant_id` как часть payload.

### Enforcement слой

- middleware/guard проверяет `activeTenantId` в сессии;
- policy service проверяет существование `ACTIVE membership` на этот tenant;
- доменный сервис дополнительно проверяет `access_state`, если операция write-sensitive;
- внутренние admin/support операции обходят только public guard, но не bypass доменных инвариантов.

### Что считается нарушением

- чтение объекта чужого tenant по угадываемому `id`;
- write в tenant без membership;
- хранение shared entity без явного `tenant_id`, если она относится к бизнес-данным компании.

## 11. Контракт AccessState и enforcement

### Разрешенные переходы

- `EARLY_ACCESS -> TRIAL_ACTIVE`
- `TRIAL_ACTIVE -> ACTIVE_PAID`
- `TRIAL_ACTIVE -> TRIAL_EXPIRED`
- `TRIAL_EXPIRED -> ACTIVE_PAID`
- `TRIAL_EXPIRED -> SUSPENDED`
- `ACTIVE_PAID -> GRACE_PERIOD`
- `ACTIVE_PAID -> SUSPENDED`
- `GRACE_PERIOD -> ACTIVE_PAID`
- `GRACE_PERIOD -> SUSPENDED`
- `SUSPENDED -> ACTIVE_PAID`
- `SUSPENDED -> CLOSED`
- `EARLY_ACCESS -> CLOSED`
- `TRIAL_ACTIVE -> CLOSED`
- `ACTIVE_PAID -> CLOSED`

### Правила применения

- изменение `AccessState` не должно происходить обычным `PATCH tenant`;
- источником transition может быть billing, support override или системный scheduler;
- каждое изменение обязано писать event в `tenant_access_state_events` и общий audit;
- mapping subscription state -> access state живет в policy service, а не в UI и не в разрозненных cron.

### Business effect по состояниям

- `EARLY_ACCESS`: доступ разрешен по special policy;
- `TRIAL_ACTIVE`: full access в рамках trial;
- `TRIAL_EXPIRED`: tenant переводится в read-only режим сразу после окончания trial, новые write-операции блокируются;
- `ACTIVE_PAID`: полный доступ;
- `GRACE_PERIOD`: доступ сохранен временно, но нужен billing warning;
- `SUSPENDED`: блокируются основные write-операции, разрешается limited read/billing/support access;
- `CLOSED`: пользовательский доступ к tenant прекращается полностью.

## 12. Алгоритмы и runtime flow

### Создание tenant

1. Проверить, что пользователь аутентифицирован.
2. Провалидировать `name`, `inn`, `tax_system`, `country`, `currency`, `timezone`.
3. Проверить уникальность ИНН на уровне БД и доменного сервиса.
4. В одной транзакции создать `tenant`, `tenant_settings`, `membership PRIMARY_OWNER`.
5. Установить `access_state=TRIAL_ACTIVE`.
6. Обновить `last_used_tenant_id` пользователя.
7. Создать audit и access-state event.

### Переключение tenant

1. Получить tenant список пользователя.
2. Проверить `ACTIVE membership` в выбранном tenant.
3. Проверить, что tenant не `CLOSED`.
4. Обновить active tenant в auth/session context.
5. Вернуть refreshed bootstrap payload.

### Guard tenant-scoped запроса

1. Извлечь `activeTenantId` из токена/сессии.
2. Проверить membership пользователя.
3. Проверить access-state policy для конкретного action.
4. Выполнить доменную операцию только в validated tenant scope.

### Закрытие tenant

1. Перевести `access_state` в `CLOSED`.
2. Пометить `status=closed`, сохранить `closed_at`.
3. Создать `tenant_closure_job` на дату `closed_at + retention window`.
4. Оставить tenant видимым в selector/history как `CLOSED`, но запретить вход внутрь и показать CTA на обращение в поддержку.

## 13. Валидации и ошибки

### Валидации

- ИНН обязателен и уникален глобально;
- `country`, `currency`, `timezone` валидируются по whitelist/reference data;
- только `PRIMARY_OWNER` может менять базовые настройки tenant на MVP;
- free-form изменение `inn` запрещено;
- tenant creation должна быть идемпотентна по request key, чтобы избежать дублей при повторном submit.

### Ошибки

- `CONFLICT: TENANT_INN_ALREADY_EXISTS`
- `FORBIDDEN: TENANT_CREATE_REQUIRES_AUTH`
- `FORBIDDEN: TENANT_SETTINGS_OWNER_ONLY`
- `FORBIDDEN: TENANT_ACCESS_DENIED`
- `CONFLICT: TENANT_ACCESS_STATE_TRANSITION_NOT_ALLOWED`
- `NOT_FOUND: TENANT_NOT_FOUND`
- `FORBIDDEN: TENANT_CLOSED`

## 14. Security требования

- tenant context не принимается на доверии из client payload без membership-проверки;
- `activeTenantId` должен переиздаваться или серверно фиксироваться при switch;
- support/admin не имеют права прямого SQL-like изменения tenant state мимо доменных сервисов;
- `inn` и прочие бизнес-реквизиты должны логироваться аккуратно без лишнего дублирования в technical logs;
- closed/suspended tenant не должен оставаться доступным через старые токены без повторной backend-проверки access state.

## 15. Async процессы и события

### Доменные события

- `tenant_created`
- `tenant_settings_updated`
- `tenant_access_state_changed`
- `tenant_selected_as_active`
- `tenant_closed`
- `tenant_retention_scheduled`
- `tenant_retention_processed`

### Async owner и обработка

| Процесс | Owner | Retry strategy | Observability |
|---------|-------|----------------|---------------|
| Старт trial/subscription bootstrap | Billing worker/service | retry with idempotency | tenant->trial bootstrap lag |
| Scheduler trial/grace transitions | Billing/Tenant policy scheduler | exponential retry | stuck transitions, overdue tenants |
| Closure retention processing | Tenant lifecycle job | retry with dead-letter | pending/failed closure jobs |
| Access warning notifications | Notifications worker | retry with backoff | warning sent/open rate |

## 16. Тестовая матрица

- Создание первого tenant пользователем без компаний.
- Повторный submit формы создания tenant с тем же idempotency key.
- Попытка создать tenant с уже существующим ИНН.
- Автовыбор единственного tenant после login.
- Переключение между несколькими tenant.
- Попытка переключиться в tenant без membership.
- Доступ к tenant-scoped данным другого tenant по прямому `id`.
- Переход `TRIAL_ACTIVE -> TRIAL_EXPIRED`.
- Переход `GRACE_PERIOD -> SUSPENDED`.
- Блокировка write-операций в `SUSPENDED`.
- Полный запрет доступа в `CLOSED`.
- Постановка retention job после закрытия tenant.

## 17. Нефункциональные требования и SLA

- чтение tenant bootstrap/current tenant должно укладываться в `p95 < 250 мс`;
- tenant switch должен становиться эффективным для новых запросов практически сразу, целевой `p95 < 1 сек`;
- access-state change после billing/support transition должен вступать в силу не позже чем через `1 минуту`;
- tenant isolation считается критическим инвариантом; любая cross-tenant утечка — security incident;
- retention processing должен быть идемпотентным и воспроизводимым.

## 18. Observability, логи и алерты

- метрики: `tenants_created`, `tenant_switch_total`, `tenant_switch_failed`, `tenant_access_state_changed`, `tenant_closed_total`, `cross_tenant_access_denied`, `retention_jobs_pending`, `retention_jobs_failed`;
- логи: tenant creation, settings update, access-state transitions, denied scope checks, closure scheduling;
- алерты: повторяющиеся tenant switch failures, попытки cross-tenant access, stuck `TRIAL_EXPIRED/GRACE_PERIOD` without transition, failed closure jobs;
- dashboards: tenant growth, access-state distribution, isolation guard health, closure backlog.

## 19. Риски реализации и архитектурные замечания

- самая опасная ошибка: считать, что membership-проверка в одном middleware достаточно защищает все cross-tenant сценарии; доменные join и worker payload тоже должны быть tenant-safe;
- `AccessState` нельзя позволять менять через обычный settings update, иначе billing/admin быстро размоют инварианты;
- `primary_owner_user_id` и `memberships` должны обновляться согласованно, иначе tenant summary начнет врать;
- глобальная уникальность ИНН требует отдельного решения для `CLOSED` tenant, иначе future restore/recreate сценарии будут конфликтовать;
- `SUSPENDED` должен быть policy-driven, иначе одни модули останутся write-enabled, а другие нет.

## 20. Открытые вопросы к продукту и архитектуре

- На текущий момент открытых продуктовых вопросов по MVP tenant не осталось.

## 21. Подтвержденные продуктовые решения

- при `TRIAL_EXPIRED` tenant сразу переводится в read-only режим;
- ИНН закрытого tenant освобождается после завершения retention и фактического удаления данных.
- `CLOSED` tenant можно восстановить в рамках retention window в MVP.
- `CLOSED` tenant показывается пользователю как недоступный в selector/history, но вход внутрь запрещен; рядом должен быть CTA на обращение в поддержку.

## 22. Фазы внедрения

1. `tenants`, `tenant_settings`, `tenant_access_state_events`, базовый create/get/switch API.
2. Tenant isolation guard и active tenant bootstrap.
3. AccessState policy layer и internal transition endpoints.
4. Settings management и warning/read-models.
5. Closure/retention lifecycle и observability.

## 23. Чеклист готовности раздела

- [x] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [x] AccessState, data isolation и retention lifecycle описаны отдельно и явно.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Стыки с auth, team, billing и admin не противоречат друг другу.
- [x] Открытые продуктовые решения выделены отдельно.

## 23.1 Чеклист реализации (по задачам)

- [x] T2-01: Tenant data model — схема, миграция, code references
- [x] T2-02: Tenant create / list / get / switch API
- [x] T2-03: Tenant isolation guard и active tenant bootstrap
- [x] T2-04: AccessState policy layer и internal transition endpoints
- [x] T2-05: Settings management и access warnings read-model
- [x] T2-06: Closure / retention lifecycle
- [x] T2-07: QA, regression и observability

## 24. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Создана системная аналитика для модуля tenant и зафиксированы открытые вопросы | Codex |
| 2026-04-18 | Зафиксированы решения по `TRIAL_EXPIRED` и освобождению ИНН после удаления tenant | Codex |
| 2026-04-18 | Зафиксированы решения по восстановлению `CLOSED` tenant и отображению закрытой компании в selector/history | Codex |
| 2026-04-26 | T2-02 выполнен: TenantModule с нуля — POST /tenants (транзакция: Tenant+Settings+Membership+AccessStateEvent, TRIAL_ACTIVE, upsert lastUsedTenantId), GET /tenants, GET /tenants/current, GET /tenants/:id, POST /tenants/:id/switch, inn-uniqueness guard, closed-tenant block, tsc clean | Claude |
| 2026-04-26 | T2-03 выполнен: ActiveTenantGuard (глобальный APP_GUARD) — trusted tenant context из X-Tenant-Id header или UserPreference, жёсткий/мягкий режим, блокировка CLOSED по status и accessState; @SkipTenantGuard / @ActiveTenantId декораторы; getMe расширен до полного bootstrap (activeTenant, tenants[], nextRoute); jwt.strategy исправлен (убран memberships[0]); switchTenant блокирует accessState=CLOSED; tsc clean | Claude |
| 2026-04-26 | TASK_TENANT_6 выполнен: closeTenant (транзакция: status+accessState=CLOSED, closedAt, TenantAccessStateEvent, TenantClosureJob scheduledFor=+90дней); restoreTenant (проверка retention window, CLOSED→SUSPENDED, ARCHIVED closureJob); retentionUntil в formatTenantSummary; closureJob include в list/get/current; новые POST endpoints /close и /restore; tsc clean | Claude |
| 2026-04-26 | TASK_TENANT_5 выполнен: AccessStatePolicy (allowed transitions map, assertTransitionAllowed, isWriteAllowed, getWarnings); TenantWriteGuard (блокирует TRIAL_EXPIRED/SUSPENDED/CLOSED без DB); transitionAccessState в сервисе (транзакция: update tenant + TenantAccessStateEvent + audit); getAccessWarnings endpoint; ActiveTenantGuard теперь устанавливает req.activeTenant{id,status,accessState}; TenantWriteGuard применён на write-методах product/settings/sync контроллеров; tsc clean | Claude |
| 2026-04-26 | TASK_TENANT_4 выполнен: RequireActiveTenantGuard создан и применён на всех 6 доменных контроллерах (product, finance, settings, analytics, sync, audit); req.user.tenantId → req.activeTenantId везде (24 вхождения); удалён дублирующий @UseGuards(JwtAuthGuard) из settings.controller; guard chain JwtAuthGuard→ActiveTenantGuard→RequireActiveTenantGuard зафиксирован; tsc clean | Claude |
| 2026-04-26 | T2-07 выполнен: AuthContext расширен (activeTenant, tenants, switchTenant); AccessStateBanner; страницы CreateCompany (/onboarding) и TenantPicker (/tenant-picker); App.tsx — роуты + nextRoute-редиректы; MainLayout — замена store.name на activeTenant.name, баннер предупреждений; 44 регрессионных теста tenant.service.spec (create/switch/isolation/access-state/close/restore/observability — 44/44 passed); Logger в 3 guards (cross_tenant_access_denied, tenant_context_required, tenant_write_blocked); tsc clean | Claude |
| 2026-04-26 | T2-01 выполнен: расширена модель Tenant (inn, status, primaryOwnerUserId, closedAt), добавлен GRACE_PERIOD в AccessState, новые enum TenantStatus/TenantActorType/TenantClosureJobStatus, новые модели TenantSettings/TenantAccessStateEvent/TenantClosureJob, data-migration taxSystem→TenantSettings, обновлены finance.service/settings.service/seed.ts, prisma validate + tsc чисто | Claude |
