# TASK_TEAM_4 — Team RBAC, Role Matrix и Last-Owner Guard

> Модуль: `03-team`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TEAM_1`
  - `TASK_TEAM_3`
- Что нужно сделать:
  - реализовать role matrix `OWNER / ADMIN / MANAGER / STAFF`;
  - разрешить `ADMIN` отправлять invite, делать resend/cancel и удалять `MANAGER/STAFF`;
  - запретить `ADMIN` менять/удалять `OWNER` и эскалировать себя в `OWNER`;
  - реализовать `PATCH role`, `DELETE member`, `POST leave`;
  - внедрить last-owner guard: последнего owner нельзя удалить, понизить или позволить ему выйти.
- Критерий закрытия:
  - team actions соответствуют утвержденной role policy;
  - last-owner guard работает во всех mutating сценариях;
  - `MANAGER` и `STAFF` не получают скрытых team-management прав.

**Что сделано**

### Новые файлы

- `team/dto/change-role.dto.ts` — DTO с `@IsEnum(Role)` для смены роли.

### `team.service.ts` — четыре новых метода

**`listMembers(actorUserId, tenantId)`**
- OWNER/ADMIN/MANAGER — видят список; STAFF → `ROLE_CHANGE_NOT_ALLOWED`.
- Возвращает ACTIVE memberships с email пользователя.

**`changeRole(actorUserId, tenantId, membershipId, dto)`**
- Только OWNER может менять роли; назначение роли OWNER запрещено на MVP.
- Если target — OWNER: вызывает last-owner guard перед понижением.
- Записывает TeamEvent `membership_role_changed` с fromRole/toRole.

**`removeMember(actorUserId, tenantId, membershipId)`**
- OWNER удаляет любого (кроме последнего OWNER).
- ADMIN удаляет только MANAGER/STAFF — не OWNER и не другого ADMIN.
- Нельзя удалить себя через removeMember (для этого есть leaveTeam).
- Статус → `REVOKED`, `revokedAt` = now; TeamEvent `membership_removed`.

**`leaveTeam(actorUserId, tenantId, membershipId)`**
- Проверяет, что `membershipId` принадлежит вызывающему пользователю.
- Если уходит OWNER: last-owner guard.
- Статус → `LEFT`, `leftAt` = now; TeamEvent `membership_left`.

**`assertNotLastOwner(tenantId, membershipId)` — приватный хелпер**
- Считает ACTIVE OWNER в tenant, исключая указанный membershipId.
- Если `count === 0` → `FORBIDDEN: LAST_OWNER_GUARD`.

### `team.controller.ts` — четыре новых эндпоинта

- `GET /team/members` — `RequireActiveTenantGuard`
- `PATCH /team/members/:membershipId/role` — `RequireActiveTenantGuard + TenantWriteGuard`
- `DELETE /team/members/:membershipId` — `RequireActiveTenantGuard + TenantWriteGuard`
- `POST /team/members/:membershipId/leave` — `RequireActiveTenantGuard` (leave — не write-action в смысле tenant data)

### Role matrix — реализованная матрица

| Действие | OWNER | ADMIN | MANAGER | STAFF |
|---|---|---|---|---|
| Список участников | ✓ | ✓ | ✓ (read) | ✗ |
| Список инвайтов | ✓ | ✓ | ✗ | ✗ |
| Создать/resend/cancel invite | ✓ | ✓ | ✗ | ✗ |
| Сменить роль | ✓ | ✗ | ✗ | ✗ |
| Удалить OWNER | ✓* | ✗ | ✗ | ✗ |
| Удалить ADMIN | ✓ | ✗ | ✗ | ✗ |
| Удалить MANAGER/STAFF | ✓ | ✓ | ✗ | ✗ |
| Выйти из tenant | ✓* | ✓ | ✓ | ✓ |

\* с last-owner guard

TypeScript-компиляция чистая.
