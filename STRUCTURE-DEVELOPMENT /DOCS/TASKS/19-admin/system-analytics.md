# Admin-панель — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
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

- [ ] Admin RBAC middleware.
- [ ] Tenant directory + tenant 360 query.
- [ ] Support actions API с обязательным reason.
- [ ] Notes + audit trail.
- [ ] Security review high-risk операций.

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

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 24. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Убрано противоречие с billing override, добавлены support роли, tenant 360 scope и открытые решения по MVP support actions | Codex |
| 2026-04-18 | Зафиксированы confirmed decisions по MVP support actions и support role model | Codex |
