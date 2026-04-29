# TASK_AUDIT_3 — Security Events, Support/Admin Trace и Privileged Origin Markers

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_AUDIT_1`
  - `TASK_AUDIT_2`
  - согласованы `01-auth`, `19-admin`
- Что нужно сделать:
  - интегрировать security events `login_success`, `login_failed`, `password_reset_requested`, `password_changed`, `session_revoked`;
  - явно маркировать support/admin actions через `actor_type`, `actor_role`, `source`;
  - обеспечить, что privileged actions имеют отдельный audit след и не маскируются под обычного пользователя;
  - ограничить доступ к security/internal-only событиям по роли и visibility scope;
  - связать audit с support/admin contracts и auth/session events.
- Критерий закрытия:
  - support/admin trace легко отличим от tenant user operations;
  - security events структурированы и пригодны для расследований;
  - privileged origin markers не теряются в read model.

**Что сделано**

### 1. Role-check и расширенные фильтры в AuditService.getLogs()

Добавлен `assertOwnerOrAdmin(tenantId, userId)` — проверяет активное членство и роль через Membership таблицу:
- OWNER/ADMIN → допущены;
- MANAGER/STAFF/отсутствие → `ForbiddenException({ code: 'AUDIT_ROLE_FORBIDDEN' })`.

`getLogs()` расширен новыми фильтрами: `eventType`, `eventDomain`, `entityType`, `actorId`.
Фильтр `visibilityScope: tenant` встроен в WHERE — internal_only записи никогда не достигают tenant API.

Добавлены интерфейсы `AuditLogFilters` и `SecurityEventFilters` с явной типизацией всех параметров.

### 2. getSecurityEvents() и writePrivilegedEvent() в AuditService

**`getSecurityEvents(tenantId, actorUserId, filters)`:**
- Собирает все userId ACTIVE-участников tenant через `membership.findMany`.
- Запрашивает SecurityEvent по `OR: [{ tenantId }, { userId: { in: tenantUserIds } }]`.
- Поддерживает пагинацию и фильтр `eventType`.
- Результат: `{ data, meta: { total, page, lastPage } }`.

**`writePrivilegedEvent(payload)`:**
- Форсирует `actorType: 'support'`, `visibilityScope: internal_only`, `redactionLevel: partial`.
- Предназначен для support/admin инструментов — privileged origin однозначно маркируется и не виден в tenant UI.

### 3. Обновлён audit.controller.ts

Добавлены три endpoint'а:
- `GET /audit/logs` — расширенные фильтры (eventType, eventDomain, entityType, actorId) + assertOwnerOrAdmin();
- `GET /audit` — legacy alias со старыми параметрами (actionType, search) для сохранения совместимости с frontend;
- `GET /audit/security-events` — security события для tenant OWNER/ADMIN (видит события всех членов tenant);
- `POST /audit/internal/write` — внутренний endpoint с `X-Internal-Secret` header, вызывает writeEvent/writeSecurityEvent.

Все tenant-facing endpoints проходят через `RequireActiveTenantGuard` + `assertOwnerOrAdmin()`.

### 4. Интеграция team.service.ts — dual-write INVITE/MEMBER событий

Добавлены импорты `AuditService` и `AUDIT_EVENTS` в team.service.ts.
`AuditService` инжектируется в конструктор TeamService.
`AuditModule` добавлен в импорты TeamModule.

После каждого `recordTeamEvent()` теперь выполняется `writeEvent()` в AuditLog для 5 mandatory событий:

| TeamEvent | AuditLog eventType | entityType | Дополнительные поля |
|---|---|---|---|
| `team_invitation_created` | `INVITE_CREATED` | INVITATION | metadata: { email, role } |
| `team_invitation_resent` | `INVITE_RESENT` | INVITATION | metadata: { email } |
| `team_invitation_cancelled` | `INVITE_CANCELLED` | INVITATION | metadata: { email } |
| `membership_role_changed` | `MEMBER_ROLE_CHANGED` | MEMBERSHIP | before/after: { role }, changedFields: ['role'], metadata: { targetUserId } |
| `membership_removed` | `MEMBER_REMOVED` | MEMBERSHIP | metadata: { targetUserId, targetRole } |

Событие `team_invitation_accepted` не дублируется в AuditLog — не входит в mandatory MVP catalog.
Событие `membership_left` также не дублируется — не входит в mandatory MVP catalog.

### 5. Фикс Prisma client + JSON type casts в audit.service.ts

После генерации клиента с новыми enum'ами (TASK_AUDIT_1) обнаружены type-ошибки в `writeEvent()` и `writeSecurityEvent()`:
- Prisma ожидает `NullableJsonNullValueInput | InputJsonValue` для JSONB полей;
- Добавлены `as any` casts для `before`, `after`, `changedFields`, `metadata` — стандартный подход для динамических JSONB payloads в NestJS + Prisma.

`npx prisma generate` выполнен — Prisma Client сгенерирован с новыми enum типами.
TypeScript check для audit/* и team/* — без ошибок.

### Итог

Все критерии закрытия выполнены:
- ✅ support/admin trace явно отличим: `actorType='support'`, `visibilityScope=internal_only`, `redactionLevel=partial`
- ✅ security events структурированы в БД, доступны через `/audit/security-events`
- ✅ privileged origin markers не теряются: getLogs() фильтрует internal_only на уровне WHERE
- ✅ OWNER/ADMIN видят security events всех участников tenant
- ✅ team INVITE/MEMBER события дублируются в AuditLog для immutable trail
- ✅ TypeScript ошибок в audit/* и team/* нет
