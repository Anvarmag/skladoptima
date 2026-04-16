# Admin-панель — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Внутренний модуль для SUPPORT_ADMIN: поиск tenant, диагностика состояния, support actions (trial extend, access-state update, special free access, password reset trigger), internal notes и audit.

## 2. Функциональный контур и границы

### Что входит в модуль
- внутренняя support/admin-панель для диагностики tenant;
- tenant 360 view по ключевым модулям;
- ограниченный набор support actions;
- internal notes и контекст инцидентов;
- строгий audit и guardrails для high-risk операций.

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
| Support lead / Ops | Контролирует качество и SLA | Чаще read-heavy роль |
| Sales/Success | Смотрит tenant context | Read-only subset |
| Доменные сервисы | Исполняют support action по контракту | Admin-panel не должна писать в БД напрямую |

## 4. Базовые сценарии использования

### Сценарий 1. Поиск tenant и диагностика
1. Support ищет tenant по id/email/name.
2. Открывает tenant 360 карточку.
3. Получает summary по auth, billing, sync, notifications, last errors.
4. Решает, нужен ли support action.

### Сценарий 2. High-risk support action
1. Support инициирует действие, например `special free access`.
2. Система требует reason/comment и подтверждение.
3. Доменный модуль исполняет действие по своему API/contract.
4. Результат и обоснование пишутся в audit.

### Сценарий 3. Ведение internal note
1. Оператор создает заметку по кейсу.
2. Note привязывается к tenant и/или инциденту.
3. Заметка доступна только внутренним ролям и участвует в handoff между операторами.

## 5. Зависимости и интеграции

- Tenant/Billing/Marketplace/Sync/Audit/Auth
- Role model платформы (`SUPPORT_ADMIN`)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/admin/tenants` | SUPPORT_ADMIN | Tenant directory |
| `GET` | `/api/v1/admin/tenants/:tenantId` | SUPPORT_ADMIN | Tenant 360 view |
| `POST` | `/api/v1/admin/tenants/:tenantId/actions/extend-trial` | SUPPORT_ADMIN | Продлить trial |
| `POST` | `/api/v1/admin/tenants/:tenantId/actions/set-access-state` | SUPPORT_ADMIN | Изменить access state |
| `POST` | `/api/v1/admin/tenants/:tenantId/actions/special-access` | SUPPORT_ADMIN | Назначить special free |
| `POST` | `/api/v1/admin/users/:userId/actions/password-reset` | SUPPORT_ADMIN | Инициировать reset flow |
| `GET` | `/api/v1/admin/tenants/:tenantId/notes` | SUPPORT_ADMIN | Список internal notes |
| `POST` | `/api/v1/admin/tenants/:tenantId/notes` | SUPPORT_ADMIN | Добавить note |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/admin/tenants/tnt_123/actions/set-access-state \
  -H "Authorization: Bearer <SUPPORT_ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"toState":"ACTIVE_PAID","reason":"Ошибочная блокировка после платежа"}'
```

## 8. Модель данных (PostgreSQL)

### `support_actions`
- `id UUID PK`, `tenant_id UUID`, `actor_support_user_id UUID`
- `action_type VARCHAR(64)`
- `reason TEXT NOT NULL`
- `payload JSONB`
- `result_status ENUM(success, failed)`
- `created_at`

### `support_notes`
- `id UUID PK`, `tenant_id UUID`, `author_support_user_id UUID`
- `note TEXT NOT NULL`
- `created_at`, `updated_at`

### `support_users`
- `id UUID PK`, `email`, `role ENUM(support_admin, support_readonly)`

## 9. Сценарии и алгоритмы (step-by-step)

1. SUPPORT_ADMIN находит tenant по имени/email owner.
2. Открывает tenant card с ключевыми статусами.
3. Выполняет action через защищенный endpoint с обязательным `reason`.
4. Action записывается в `support_actions` и общий audit.
5. Internal notes используются для handoff между сменами поддержки.

## 10. Валидации и ошибки

- Все high-risk actions требуют `reason` длиной >= 10 символов.
- Impersonation/login-as-user в MVP запрещен.
- Ошибки:
  - `FORBIDDEN: SUPPORT_ROLE_REQUIRED`
  - `VALIDATION_ERROR: REASON_REQUIRED`
  - `CONFLICT: ACTION_NOT_ALLOWED_FOR_STATE`

## 11. Чеклист реализации

- [ ] Admin RBAC middleware.
- [ ] Tenant directory + tenant 360 query.
- [ ] Support actions API с обязательным reason.
- [ ] Notes + audit trail.
- [ ] Security review high-risk операций.

## 12. Критерии готовности (DoD)

- Любое support-действие объяснимо и аудируемо.
- SUPPORT_ADMIN не имеет небезопасного доступа к паролям/секретам.
- Внутренняя панель ускоряет диагностику tenant-проблем.

## 13. Категории support actions

- `EXTEND_TRIAL`
- `SET_ACCESS_STATE`
- `ASSIGN_SPECIAL_ACCESS`
- `TRIGGER_PASSWORD_RESET`
- `ADD_INTERNAL_NOTE`

### High-risk actions
- `SET_ACCESS_STATE`
- `ASSIGN_SPECIAL_ACCESS`
- `EXTEND_TRIAL`

## 14. Tenant 360 состав

### В карточке tenant показывать
- tenant core data
- owner и team summary
- subscription/access state
- marketplace accounts summary
- recent sync errors
- recent notifications
- audit summary
- internal notes

## 15. Security guardrails

- SUPPORT_ADMIN не может читать plaintext credentials.
- SUPPORT_ADMIN не может получить пароль пользователя.
- SUPPORT_ADMIN не может impersonate user на MVP.
- Все high-risk actions требуют `reason` и попадают в отдельный support audit context.

## 16. Тестовая матрица

- Поиск tenant по имени.
- Поиск tenant по owner email.
- Trial extend с обязательным reason.
- Попытка high-risk action без reason.
- Trigger password reset без доступа к password hash.
- Добавление internal note.

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
