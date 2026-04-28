# Аудит и история — Системная аналитика

> Статус: [x] В разработке
> Последнее обновление: 2026-04-28
> Связанный раздел: `16-audit`

## 1. Назначение модуля

Модуль хранит неизменяемую историю значимых бизнес- и security-событий tenant для расследований, контроля действий команды и support-операций.

### Текущее состояние (as-is)

- в backend уже существует модуль `audit` с read endpoint, а во frontend есть страница `History`;
- текущий слой уже покрывает базовый просмотр истории, но не оформлен как полный immutable audit и security explorer;
- filtering, detail drill-down и role-aware audit policy описаны в документации глубже, чем выражены в текущем коде.

### Целевое состояние (to-be)

- audit должен стать единым immutable слоем фиксации критичных действий пользователя и системы;
- security events и business audit должны быть связаны, но логически разведены по назначению;
- audit должен использоваться как инструмент расследования, а не только как passive log;
- любая support/admin операция, меняющая tenant данные или доступ, должна иметь отдельный и явно различимый audit след.


## 2. Функциональный контур и границы

### Что входит в модуль
- immutable журнал критичных бизнес- и security-событий;
- хранение actor, scope, before/after, correlation ids;
- tenant-facing и internal search/drill-down по audit trail;
- контроль полноты покрытия критичных действий;
- support/security расследовательский контекст;
- masking/redaction policy для чувствительных полей в read-модели.

### Что не входит в модуль
- технические application logs и distributed tracing как отдельная инфраструктура;
- системный monitoring/metrics;
- пользовательские ленты активности произвольного формата;
- редактирование или удаление audit records бизнес-пользователем.

### Главный результат работы модуля
- любое критичное действие в системе имеет доказательный след: кто, где, когда и что именно изменил.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Доменные модули | Пишут audit records на критичных операциях | Не должны писать произвольный неструктурированный мусор |
| Owner/Admin | Просматривает tenant audit по своим правам | Не видит чужие tenant scope |
| Support/Security | Расследует инциденты | Имеет расширенный, но контролируемый доступ |
| Admin panel / support tools | Выполняют privileged actions | Любое действие обязано логироваться отдельным `support/admin` event |
| Audit service | Гарантирует immutable storage и query API | Не владеет бизнес-правилами модулей |

## 4. Базовые сценарии использования

### Сценарий 1. Create/update/delete сущности
1. Доменный сервис выполняет бизнес-операцию.
2. Формирует audit payload с actor, entity, before/after.
3. Запись фиксируется в immutable storage.
4. При необходимости становится доступной в tenant audit UI.

### Сценарий 2. Security событие
1. Auth/support layer создает security event.
2. Audit service помечает категорию как `security`.
3. Запись доступна внутренним ролям и, при политике, частично tenant owner.

### Сценарий 3. Расследование инцидента
1. Support/Security открывает поиск по tenant/entity/actor/requestId.
2. Получает связанный набор записей.
3. Использует correlation-id для стыковки с technical logs и инцидентом.

### Сценарий 4. Tenant недоступен, но audit нужен
1. Tenant переходит в `TRIAL_EXPIRED`, `SUSPENDED` или `CLOSED`.
2. Новые write-события от прикладных модулей блокируются их собственными guard rules.
3. Исторический audit trail остается доступным для чтения по RBAC.
4. Support и Owner могут использовать audit для разбирательства причин блокировки, закрытия или спорных действий.

## 5. Зависимости и интеграции

- Все бизнес-модули (producer audit events)
- Auth security events
- Admin panel support actions

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/audit/logs` | Owner/Admin | Список audit записей |
| `GET` | `/api/v1/audit/logs/:id` | Owner/Admin | Детали записи |
| `GET` | `/api/v1/audit/security-events` | Owner/Admin | Security события |
| `GET` | `/api/v1/audit/coverage-status` | Owner/Admin | Диагностика покрытия и health audit writer |
| `POST` | `/api/v1/audit/internal/write` | Internal | Внутренняя запись audit события |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/audit/logs?entityType=PRODUCT&from=2026-04-01&to=2026-04-15&page=1&limit=20' \
  -H "Authorization: Bearer <JWT>"
```

```json
{
  "items": [
    {
      "id": "aud_...",
      "eventType": "STOCK_ADJUSTED",
      "entityType": "PRODUCT",
      "entityId": "prd_...",
      "actor": { "type": "user", "id": "usr_..." },
      "before": { "onHand": 10 },
      "after": { "onHand": 7 },
      "createdAt": "2026-04-15T11:00:00Z"
    }
  ]
}
```

### Frontend поведение

- Текущее состояние: маршрут `/app/history` уже существует как текущий экран истории изменений.
- Целевое состояние: нужны фильтры, detail drill-down, before/after diff и role-aware security views.
- UX-правило: пользователь должен быстро понимать что изменилось, кто инициировал событие и к какой сущности оно относится.
- В MVP экран audit доступен только `OWNER` и `ADMIN`; `MANAGER/STAFF` доступа не имеют.
- При `TRIAL_EXPIRED / SUSPENDED / CLOSED` history screen остается доступным для чтения, если сама сессия пользователя валидна и роль допускает просмотр.

## 8. Модель данных (PostgreSQL)

### `audit_logs`
- `id UUID PK`, `tenant_id UUID`
- `event_type VARCHAR(64)`, `event_domain VARCHAR(32)`, `entity_type VARCHAR(64)`, `entity_id VARCHAR(64)`
- `actor_type ENUM(user, system, support, marketplace)`
- `actor_id UUID NULL`
- `actor_role VARCHAR(32) NULL`
- `source ENUM(ui, api, worker, marketplace)`
- `request_id UUID NULL`, `correlation_id UUID NULL`
- `before JSONB NULL`, `after JSONB NULL`, `changed_fields JSONB NULL`, `metadata JSONB NULL`
- `visibility_scope ENUM(tenant, internal_only) NOT NULL DEFAULT 'tenant'`
- `redaction_level ENUM(none, partial, strict) NOT NULL DEFAULT 'none'`
- `created_at TIMESTAMPTZ`
- Индексы: `(tenant_id, created_at DESC)`, `(tenant_id, entity_type, entity_id)`, `(tenant_id, actor_id, created_at DESC)`, `(request_id)`

### `security_events`
- `id UUID PK`, `tenant_id UUID NULL`, `user_id UUID NULL`
- `event_type ENUM(login_success, login_failed, password_reset_requested, password_changed, session_revoked)`
- `ip INET`, `user_agent TEXT`, `request_id UUID NULL`, `metadata JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Бизнес-сервис определяет, относится ли действие к mandatory audit catalog.
2. Формирует audit payload с actor, scope, request/correlation ids и redaction level.
3. Для mutating actions вычисляет `before`, `after`, `changed_fields`.
4. Audit write выполняется в той же транзакции или outbox-механизмом.
5. Для support/admin действий actor_type и source должны явно отражать privileged origin.
6. Для tenant read API применяется role-scope фильтрация и masking.
7. Запись immutable: update/delete API не существует.
8. Security events пишутся отдельно и доступны ограниченному кругу ролей.
9. Internal-only записи не отдаются в tenant-facing audit UI.

## 10. Валидации и ошибки

- `event_type`, `entity_type` обязательны.
- `before/after` должны быть JSON-объектами.
- `visibility_scope=internal_only` запрещено отдавать в tenant-facing API.
- Чувствительные поля (`password`, `token`, `secret`, `apiKey`, `refreshToken`, полный `email verification token`) не должны попадать в raw payload.
- Ошибки:
  - `FORBIDDEN: AUDIT_SCOPE_RESTRICTED`
  - `NOT_FOUND: AUDIT_RECORD_NOT_FOUND`
  - `FORBIDDEN: AUDIT_INTERNAL_ONLY_RECORD`
  - `VALIDATION_ERROR: AUDIT_PAYLOAD_CONTAINS_SENSITIVE_FIELDS`

## 11. Чеклист реализации

- [x] Таблицы `audit_logs`, `security_events`. _(TASK_AUDIT_1)_
- [ ] Унифицированный internal audit writer.
- [ ] Ролевой доступ к просмотру аудита.
- [ ] Интеграция с support actions и auth.

## 12. Критерии готовности (DoD)

- Критичные действия не теряются из аудита.
- Записи неизменяемы.
- Фильтрация и drill-down достаточны для расследований.
- Support/admin actions явно различимы от обычных пользовательских операций.
- Чувствительные значения маскируются и не утекают в tenant UI.

## 13. Audit taxonomy

### Business audit domains
- `INVENTORY`
- `TEAM`
- `MARKETPLACE`
- `CATALOG`
- `FINANCE`
- `BILLING`
- `TENANT`
- `SUPPORT`

### Security event domains
- `AUTH`
- `SESSION`
- `PASSWORD`

### Mandatory MVP audit events
- `AUTH`: login success/failed, password reset requested/completed, logout-all, session revoked.
- `TEAM`: invite created/resend/cancel, membership role changed, member removed.
- `TENANT`: tenant created, tenant state changed, tenant closed, tenant restored.
- `CATALOG`: product created, product updated, product archived/soft-deleted, duplicate merge.
- `INVENTORY`: manual stock adjustment, stock correction import applied.
- `MARKETPLACE`: marketplace account connected, credentials updated/revalidated, account deactivated.
- `SYNC`: manual sync requested, retry requested, sync blocked by policy, sync failed terminally.
- `BILLING`: trial started/expired, subscription changed, payment status changed, suspension/grace entered.
- `SUPPORT`: privileged access granted, tenant data changed via admin tool, tenant restored/closed by support.

## 14. Правила immutable storage

- API update/delete для audit-record отсутствует.
- Изменение записи в БД запрещено бизнес-логикой и DBA policy.
- Любая коррекция делается новой компенсирующей записью, а не редактированием старой.

## 15. Write strategy

### Предпочтительный вариант
- писать audit в той же транзакции, что и бизнес-изменение

### Допустимый вариант
- outbox event + reliable async writer

### Недопустимый вариант
- best-effort логирование после коммита без гарантии доставки

## 16. Before/After и redaction policy

- Для create/update/delete и state transition событий в MVP сохраняется `changed_fields` всегда.
- Полные `before/after` snapshots допускаются только для малых конфигурационных сущностей и записей без чувствительных полей.
- Для крупных payload или рискованных сущностей сохраняется summary diff + безопасные ключевые поля, а не полный слепок объекта.
- Security events не хранят секреты, одноразовые токены, полные credential values и иные чувствительные значения.
- Tenant-facing read model может дополнительно маскировать IP, email и support metadata по RBAC policy.

## 17. Тестовая матрица

- Audit при ручной stock корректировке.
- Audit при role change.
- Security event при failed login.
- Audit support/admin action с отдельным actor/source.
- Маскирование чувствительных полей в detail view.
- Ограничение видимости audit для Manager.
- Попытка доступа Staff к audit.
- Доступность history screen в `TRIAL_EXPIRED / SUSPENDED / CLOSED`.

## 18. Фазы внедрения

1. Core audit tables.
2. Unified audit writer contract.
3. Security events integration.
4. Read API with RBAC filters.
5. Retention/display policy by plan.

## 19. Нефункциональные требования и SLA

- Audit write path должен быть крайне надежным; потеря критичной записи рассматривается как инцидент.
- Поиск по audit trail должен поддерживать tenant/entity/actor/time filters с целевым `p95 < 700 мс` на стандартных запросах.
- Immutable storage означает запрет на скрытое изменение полезной нагрузки записи после создания.
- Чувствительные поля должны маскироваться в read-модели audit по RBAC policy.
- Tenant access-state не должен лишать Owner/Admin исторического чтения audit trail, если иное не продиктовано security policy.

## 20. Observability, логи и алерты

- Метрики: `audit_records_written`, `audit_write_failures`, `security_events_logged`, `audit_queries`, `rbac_denied_on_audit`.
- Логи: write attempts, source module, payload size/class, query filters for internal diagnostics.
- Алерты: любой audit write failure по critical module, spikes in access denials, unexpected drop in event volume.
- Dashboards: audit coverage, security event board, support-action compliance board.

## 21. Риски реализации и архитектурные замечания

- Частая ошибка: пытаться использовать audit как замену application logs; это другой слой и другая granularity.
- Если формат записи не стандартизировать сразу, поиск и расследование быстро станут дорогими.
- Нужно заранее решить, какие поля хранятся как before/after diff, а какие как summary snapshot.
- Support/admin действия должны иметь явно отличный тип audit-события от пользовательских операций.
- Если tenant-facing UI увидит internal-only support записи без redaction, это создаст прямой security и trust risk.

## 22. Открытые вопросы к продукту и архитектуре

- Для MVP открытых product/blocking questions не осталось.

## 23. Подтвержденные решения

- Mandatory MVP event catalog подтвержден в текущем виде, без аудита каждого просмотра и без логирования некритичных browse-событий.
- В MVP используется `summary diff + safe key fields` по умолчанию, а полные `before/after` snapshots допускаются только для малых и безопасных сущностей.
- Retention window для tenant-facing audit trail в MVP = `180 дней`.
- Cold storage и long-term archival policy не входят в первую версию.

## 24. Чеклист готовности раздела

- [x] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [x] Async-процессы, observability и тестовая матрица описаны.
- [x] Риски, ограничения и rollout-порядок зафиксированы.

## 25. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены MVP event catalog, redaction policy, access-state rules и открытые решения по retention/before-after | Codex |
| 2026-04-18 | Зафиксированы confirmed decisions по scope audit events, before/after policy и retention window | Codex |
| 2026-04-28 | TASK_AUDIT_1: data model реализован — новые enums, расширена AuditLog, создана SecurityEvent, миграция, TypeScript event catalog, AuditService.writeEvent() | Claude |
