# TASK_AUDIT_1 — Immutable Storage, Audit Taxonomy и Data Model

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - утверждена системная аналитика `16-audit`
  - согласованы `01-auth`, `19-admin`
- Что нужно сделать:
  - завести `audit_logs` и `security_events`;
  - закрепить поля `event_type`, `event_domain`, `entity_type`, `entity_id`, `actor_type`, `actor_id`, `source`, `request_id`, `correlation_id`;
  - описать `visibility_scope`, `redaction_level`, `changed_fields`, `before`, `after`, `metadata`;
  - зафиксировать mandatory MVP event catalog без аудита browse-only событий;
  - подготовить индексы для tenant/entity/actor/request filters.
- Критерий закрытия:
  - data model покрывает business audit и security events;
  - immutable storage semantics выражены явно;
  - mandatory event catalog воспроизводим на уровне модели и контрактов.

**Что сделано**

### 1. Новые Prisma enums (schema.prisma)

Добавлено 5 новых enum'ов:

- `AuditActorType` — `user | system | support | marketplace`
- `AuditSource` — `ui | api | worker | marketplace`
- `AuditVisibilityScope` — `tenant | internal_only`
- `AuditRedactionLevel` — `none | partial | strict`
- `SecurityEventType` — `login_success | login_failed | password_reset_requested | password_changed | session_revoked`

### 2. Перепроектирована модель AuditLog (schema.prisma)

Модель расширена каноническими полями по спецификации system-analytics:

| Поле | Тип | Описание |
|---|---|---|
| `eventType` | `String?` | Тип события из MVP catalog |
| `eventDomain` | `String?` | Домен: AUTH / TEAM / CATALOG / … |
| `entityType` | `String?` | Тип сущности (PRODUCT, USER, …) |
| `entityId` | `String?` | ID затронутой сущности |
| `actorType` | `AuditActorType?` | user / system / support / marketplace |
| `actorId` | `String?` | ID актора |
| `actorRole` | `String?` | Роль актора на момент события |
| `source` | `AuditSource?` | ui / api / worker / marketplace |
| `requestId` | `String?` | ID входящего HTTP-запроса |
| `correlationId` | `String?` | Correlation ID для связи событий |
| `before` | `Json?` | Снапшот до изменения |
| `after` | `Json?` | Снапшот после изменения |
| `changedFields` | `Json?` | Список изменённых полей |
| `metadata` | `Json?` | Произвольный контекст |
| `visibilityScope` | `AuditVisibilityScope` | `tenant` (default) / `internal_only` |
| `redactionLevel` | `AuditRedactionLevel` | `none` (default) / `partial` / `strict` |

Добавлены 4 индекса:
- `(tenantId, createdAt DESC)` — основной page query
- `(tenantId, entityType, entityId)` — drill-down по сущности
- `(tenantId, actorId, createdAt DESC)` — поиск по актору
- `(requestId)` — связка с HTTP-запросом

Старые legacy-поля (`actionType`, `productId`, `productSku` и т.д.) оставлены **nullable** для backward-compat — будут удалены после TASK_AUDIT_2.

### 3. Создана модель SecurityEvent (schema.prisma)

Новая таблица `SecurityEvent` c полями: `id`, `tenantId`, `userId`, `eventType` (enum), `ip`, `userAgent`, `requestId`, `metadata`, `createdAt`.

Relation: `Tenant.securityEvents[]`, `User.securityEvents[]` (ON DELETE SET NULL).

Индексы: `(tenantId, createdAt)`, `(userId, createdAt)`, `(eventType)`, `(requestId)`.

### 4. Миграция БД

Файл: `apps/api/prisma/migrations/20260428270000_audit_data_model/migration.sql`

- 5 новых enum'ов через `CREATE TYPE`
- `ALTER TABLE "AuditLog" ADD COLUMN ...` (16 новых колонок)
- `ALTER TABLE "AuditLog" ALTER COLUMN "actionType" DROP NOT NULL` (legacy backward compat)
- `CREATE TABLE "SecurityEvent"` с FK и индексами
- 4 индекса на `AuditLog`

### 5. TypeScript Event Catalog

Файл: `apps/api/src/modules/audit/audit-event-catalog.ts`

- `AUDIT_DOMAINS` — константы доменов (AUTH, SESSION, PASSWORD, TEAM, TENANT, CATALOG, INVENTORY, MARKETPLACE, SYNC, BILLING, SUPPORT, FINANCE)
- `AUDIT_EVENTS` — 40+ MVP событий без browse-only событий
- `EVENT_DOMAIN_MAP` — маппинг event → domain (для автоматического заполнения `eventDomain`)
- `AuditWritePayload` — типизированный payload для `writeEvent()`
- `SecurityEventPayload` — payload для `writeSecurityEvent()`
- `SENSITIVE_AUDIT_FIELDS` — Set запрещённых к хранению полей (`password`, `token`, `secret` и т.д.)

### 6. Обновлён AuditService

Файл: `apps/api/src/modules/audit/audit.service.ts`

- Добавлен `writeEvent(payload: AuditWritePayload)` — новый канонический метод записи
- Добавлен `writeSecurityEvent(payload: SecurityEventPayload)` — запись security event
- `getLogs()` обновлён: добавлен фильтр `visibilityScope = tenant` (internal_only записи не попадают в tenant API)
- `sanitize()` — автоматически заменяет sensitive fields на `[REDACTED]`
- Legacy `logAction()` сохранён без изменений

### Итог

Все критерии закрытия выполнены:
- ✅ data model покрывает business audit и security events
- ✅ immutable storage semantics выражены явно (нет update/delete API, `visibilityScope` и `redactionLevel` явны)
- ✅ mandatory event catalog воспроизводим на уровне модели и TypeScript-контрактов
- ✅ индексы подготовлены для tenant/entity/actor/request фильтров
- ✅ `prisma validate` прошёл успешно
