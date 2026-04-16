# Аудит и история — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль хранит неизменяемую историю значимых бизнес- и security-событий tenant для расследований, контроля действий команды и support-операций.

## 2. Функциональный контур и границы

### Что входит в модуль
- immutable журнал критичных бизнес- и security-событий;
- хранение actor, scope, before/after, correlation ids;
- tenant-facing и internal search/drill-down по audit trail;
- контроль полноты покрытия критичных действий;
- support/security расследовательский контекст.

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

## 5. Зависимости и интеграции

- Все бизнес-модули (producer audit events)
- Auth security events
- Admin panel support actions

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/audit/logs` | Owner/Admin/Manager(scope) | Список audit записей |
| `GET` | `/api/v1/audit/logs/:id` | Owner/Admin/Manager(scope) | Детали записи |
| `GET` | `/api/v1/audit/security-events` | Owner/Admin | Security события |
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

## 8. Модель данных (PostgreSQL)

### `audit_logs`
- `id UUID PK`, `tenant_id UUID`
- `event_type VARCHAR(64)`, `entity_type VARCHAR(64)`, `entity_id VARCHAR(64)`
- `actor_type ENUM(user, system, support, marketplace)`
- `actor_id UUID NULL`
- `source ENUM(ui, api, worker, marketplace)`
- `before JSONB NULL`, `after JSONB NULL`, `metadata JSONB NULL`
- `created_at TIMESTAMPTZ`
- Индексы: `(tenant_id, created_at DESC)`, `(tenant_id, entity_type, entity_id)`

### `security_events`
- `id UUID PK`, `tenant_id UUID NULL`, `user_id UUID NULL`
- `event_type ENUM(login_success, login_failed, password_reset_requested, password_changed, session_revoked)`
- `ip INET`, `user_agent TEXT`, `metadata JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Бизнес-сервис формирует audit payload до и после изменения.
2. Audit write выполняется в той же транзакции или outbox-механизмом.
3. Запись immutable: update/delete API не существует.
4. На чтение применяется role-scope фильтрация (Manager видит только operational).
5. Security events пишутся отдельно и доступны ограниченному кругу ролей.

## 10. Валидации и ошибки

- `event_type`, `entity_type` обязательны.
- `before/after` должны быть JSON-объектами.
- Ошибки:
  - `FORBIDDEN: AUDIT_SCOPE_RESTRICTED`
  - `NOT_FOUND: AUDIT_RECORD_NOT_FOUND`

## 11. Чеклист реализации

- [ ] Таблицы `audit_logs`, `security_events`.
- [ ] Унифицированный internal audit writer.
- [ ] Ролевой доступ к просмотру аудита.
- [ ] Интеграция с support actions и auth.

## 12. Критерии готовности (DoD)

- Критичные действия не теряются из аудита.
- Записи неизменяемы.
- Фильтрация и drill-down достаточны для расследований.

## 13. Audit taxonomy

### Business audit domains
- `INVENTORY`
- `TEAM`
- `MARKETPLACE`
- `CATALOG`
- `FINANCE`
- `BILLING`

### Security event domains
- `AUTH`
- `SESSION`
- `PASSWORD`

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

## 16. Тестовая матрица

- Audit при ручной stock корректировке.
- Audit при role change.
- Security event при failed login.
- Ограничение видимости audit для Manager.
- Попытка доступа Staff к audit.

## 17. Фазы внедрения

1. Core audit tables.
2. Unified audit writer contract.
3. Security events integration.
4. Read API with RBAC filters.
5. Retention/display policy by plan.

## 18. Нефункциональные требования и SLA

- Audit write path должен быть крайне надежным; потеря критичной записи рассматривается как инцидент.
- Поиск по audit trail должен поддерживать tenant/entity/actor/time filters с целевым `p95 < 700 мс` на стандартных запросах.
- Immutable storage означает запрет на скрытое изменение полезной нагрузки записи после создания.
- Чувствительные поля должны маскироваться в read-модели audit по RBAC policy.

## 19. Observability, логи и алерты

- Метрики: `audit_records_written`, `audit_write_failures`, `security_events_logged`, `audit_queries`, `rbac_denied_on_audit`.
- Логи: write attempts, source module, payload size/class, query filters for internal diagnostics.
- Алерты: любой audit write failure по critical module, spikes in access denials, unexpected drop in event volume.
- Dashboards: audit coverage, security event board, support-action compliance board.

## 20. Риски реализации и архитектурные замечания

- Частая ошибка: пытаться использовать audit как замену application logs; это другой слой и другая granularity.
- Если формат записи не стандартизировать сразу, поиск и расследование быстро станут дорогими.
- Нужно заранее решить, какие поля хранятся как before/after diff, а какие как summary snapshot.
- Support/admin действия должны иметь явно отличный тип audit-события от пользовательских операций.
