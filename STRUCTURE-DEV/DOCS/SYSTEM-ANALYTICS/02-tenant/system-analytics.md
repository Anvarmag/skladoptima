# Мультитенантность — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль реализует tenant как изолированное рабочее пространство компании: создание tenant, список membership, переключение активного tenant, управление access-state.

## 2. Функциональный контур и границы

### Что входит в модуль
- создание tenant как корневой бизнес-сущности;
- хранение tenant metadata и operational state;
- переключение активного tenant для пользователя;
- модель владения tenant и базовая изоляция данных по tenant scope;
- жизненный цикл tenant от создания до suspended/read-only состояния.

### Что не входит в модуль
- детальная командная модель и invites;
- тарифы, платежи и расчет лимитов;
- бизнес-данные каталога, остатков, заказов;
- внутренняя админ-панель поддержки.

### Главный результат работы модуля
- каждый запрос системы выполняется внутри однозначного `tenant_id`, и платформа гарантирует, что данные одного tenant никогда не смешиваются с другим.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner | Создает tenant и владеет им | Не может потерять tenant без явной передачи ownership |
| Admin | Работает внутри tenant | Не должен менять owner-level критичные свойства без политики |
| Любой user с membership | Переключает текущий tenant | Только среди доступных memberships |
| Billing/Admin modules | Меняют access-state tenant | Не должны обходить tenant lifecycle |

## 4. Базовые сценарии использования

### Сценарий 1. Создание первого tenant
1. Пользователь после auth вызывает create-tenant flow.
2. Backend создает `tenant` и первичную membership с ролью `OWNER`.
3. Tenant помечается активным и готовым к onboarding.
4. Пользователь получает обновленный context с новым `tenantId`.

### Сценарий 2. Переключение tenant
1. Пользователь запрашивает список доступных memberships.
2. Клиент выбирает tenant.
3. Backend проверяет, что membership активна и tenant доступен.
4. Выпускается новый auth-context или обновляется active tenant.
5. Все последующие tenant-scoped запросы идут уже в новом контексте.

### Сценарий 3. Переход в suspended/read-only
1. Внешний модуль меняет access-state tenant.
2. Tenant module публикует новое состояние доступа.
3. Write-операции в зависимых модулях блокируются policy-слоем.
4. Read-only и billing/support маршруты остаются доступны по правилам продукта.

## 5. Зависимости и интеграции

- Auth/JWT (claims `tenantId`, `membershipId`, `role`)
- Billing (access-state)
- Team (memberships/invitations)
- Audit (tenant actions)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/tenants` | User | Создать tenant |
| `GET` | `/api/v1/tenants/my` | User | Список tenant пользователя |
| `POST` | `/api/v1/tenants/switch` | User | Переключить активный tenant |
| `GET` | `/api/v1/tenants/:tenantId` | User | Карточка tenant |
| `PATCH` | `/api/v1/tenants/:tenantId/settings` | Owner/Admin | Обновить настройки tenant |
| `GET` | `/api/v1/tenants/:tenantId/access-state` | Owner/Admin | Текущее access-state |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/tenants \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"ООО Ромашка","slug":"romashka"}'
```

```json
{
  "tenantId": "tnt_...",
  "membershipId": "mbr_...",
  "role": "OWNER",
  "accessState": "TRIAL_ACTIVE"
}
```

## 8. Модель данных (PostgreSQL)

### `tenants`
- `id UUID PK`
- `name VARCHAR(255) NOT NULL`
- `slug VARCHAR(100) UNIQUE NOT NULL`
- `owner_user_id UUID FK users(id)`
- `status ENUM(active, suspended, closed)`
- `access_state ENUM(early_access, trial_active, trial_expired, active_paid, grace_period, suspended, closed)`
- `trial_started_at`, `trial_ends_at`
- `created_at`, `updated_at`, `deleted_at`

### `memberships`
- `id UUID PK`
- `tenant_id UUID FK tenants(id)`
- `user_id UUID FK users(id)`
- `role ENUM(owner, admin, manager, staff)`
- `status ENUM(active, suspended, left)`
- `joined_at`
- `UNIQUE(tenant_id, user_id)`

### `tenant_settings`
- `tenant_id UUID PK/FK`
- `tax_system ENUM(usn_6, usn_15, osno, npd)`
- `vat_threshold_exceeded BOOLEAN`
- `timezone VARCHAR(64)`
- `updated_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Создание tenant: валидировать имя/slug, создать `tenants`, создать membership owner.
2. Переключение tenant: проверить membership active, перевыпустить JWT с новым `tenantId`.
3. Любой запрос к tenant-scoped данным: сервер берет `tenantId` только из JWT.
4. При `SUSPENDED`: read-only доступ, только billing/support endpoints для изменений.
5. Все изменения tenant пишутся в audit с `before/after`.

## 10. Валидации и ошибки

- `slug` уникален и URL-safe.
- Пользователь не может выбрать tenant без membership.
- Ошибки:
  - `NOT_FOUND: TENANT_NOT_FOUND`
  - `FORBIDDEN: MEMBERSHIP_REQUIRED`
  - `CONFLICT: TENANT_SLUG_ALREADY_EXISTS`
  - `FORBIDDEN: TENANT_SUSPENDED_WRITE_BLOCKED`

## 11. Чеклист реализации

- [ ] Миграции `tenants`, `memberships`, `tenant_settings`.
- [ ] Middleware tenant isolation.
- [ ] Endpoint `switch` с перевыпуском claims.
- [ ] Read-only policy для `SUSPENDED`.
- [ ] Audit на create/update/switch/access changes.

## 12. Критерии готовности (DoD)

- Нет cross-tenant утечек данных.
- Переключение tenant корректно меняет контекст всех модулей.
- Access-state влияет на права изменения данных согласно BRD.

## 13. RBAC и правила tenant isolation

### Кто может создавать tenant
- любой аутентифицированный пользователь без ограничений по количеству на MVP

### Кто может менять настройки tenant
- `OWNER`
- `ADMIN` только в пределах разрешенных настроек, без billing/high-risk параметров

### Базовые правила изоляции
- каждая tenant-scoped таблица содержит `tenant_id`
- в сервисах поиск и изменение сущностей всегда выполняются по составному ключу `id + tenant_id`
- переход пользователя между tenant возможен только при наличии `active membership`

## 14. Lifecycle tenant и access-state

### Бизнесовые состояния tenant
- `EARLY_ACCESS`
- `TRIAL_ACTIVE`
- `TRIAL_EXPIRED`
- `ACTIVE_PAID`
- `GRACE_PERIOD`
- `SUSPENDED`
- `CLOSED`

### Допустимые переходы
- `EARLY_ACCESS -> TRIAL_ACTIVE`
- `TRIAL_ACTIVE -> ACTIVE_PAID`
- `TRIAL_ACTIVE -> TRIAL_EXPIRED`
- `ACTIVE_PAID -> GRACE_PERIOD`
- `GRACE_PERIOD -> ACTIVE_PAID`
- `GRACE_PERIOD -> SUSPENDED`
- `SUSPENDED -> ACTIVE_PAID`
- `SUSPENDED -> CLOSED`

## 15. Внутренние события и контракты

- `tenant_created`
- `tenant_settings_updated`
- `tenant_switched`
- `tenant_access_state_changed`
- `membership_created_for_tenant`

### Какие модули обязаны слушать эти события
- Billing: на `tenant_created`
- Onboarding: на `tenant_created`
- Audit: на все tenant events
- Notifications: на `tenant_access_state_changed`

## 16. Тестовая матрица

- Создание tenant пользователем без компании.
- Создание второго tenant тем же user.
- Переключение в tenant без membership.
- Работа с resource другого tenant через прямой `id`.
- Перевод tenant в `SUSPENDED` и попытка write-операции.
- Read-only доступ при `SUSPENDED`.

## 17. Фазы внедрения

1. Tenant core: `tenants`, `memberships`, `tenant_settings`.
2. JWT claims и endpoint `switch`.
3. Tenant isolation guards/repositories.
4. Access-state policy и интеграция с billing.
5. Audit и support hooks для tenant lifecycle.

## 18. Нефункциональные требования и SLA

- Tenant switch и чтение текущего tenant context должны быть `p95 < 300 мс`.
- Любой tenant-scoped запрос обязан проходить policy-check на изоляцию без client-side trust к `tenant_id` из body/query.
- Изменение access-state должно становиться видимым зависимым модулям максимум в течение `1 мин`.
- Данные tenant не должны физически смешиваться в кешах, очередях и логах без явного `tenant_id`.

## 19. Observability, логи и алерты

- Метрики: `tenant_created`, `tenant_switch_count`, `cross_tenant_denied`, `tenant_access_state_changes`, `suspended_write_block_hits`.
- Логи: все tenant context switches, попытки доступа к чужому tenant, lifecycle transitions.
- Алерты: любой успешный cross-tenant access, аномальный всплеск deny по isolation policy, рассинхрон access-state.
- Dashboards: tenant lifecycle board, access-state monitor, isolation incident board.

## 20. Риски реализации и архитектурные замечания

- Нельзя доверять `tenant_id` из клиента как источнику прав; authoritative scope должен идти из membership/context.
- При росте числа tenant на пользователя важно не завязать всю модель на один “current tenant” без истории переключений.
- Access-state tenant не должен вычисляться ad-hoc в каждом модуле; нужна единая policy/mapping точка.
- Любые support overrides должны менять tenant state через официальный контракт, а не прямым апдейтом таблиц.
