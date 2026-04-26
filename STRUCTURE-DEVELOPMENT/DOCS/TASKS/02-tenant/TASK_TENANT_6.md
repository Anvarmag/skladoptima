# TASK_TENANT_6 — Closed Tenant Lifecycle, Restore и Retention

> Модуль: `02-tenant`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_TENANT_1`
  - `TASK_TENANT_5`

**Что сделано (2026-04-26)**

### Новые методы в `tenant.service.ts`

**`closeTenant(userId, tenantId)`**
- Проверяет, что пользователь является `primaryOwnerUserId` → иначе `403 TENANT_CLOSE_OWNER_ONLY`
- Проверяет, что tenant ещё не закрыт → иначе `409 TENANT_ALREADY_CLOSED`
- В одной транзакции:
  - Обновляет `tenant.status = CLOSED`, `accessState = CLOSED`, `closedAt = now`
  - Создаёт `TenantAccessStateEvent` (fromState → CLOSED, reasonCode: OWNER_CLOSED)
  - Upsert `TenantClosureJob` с `scheduledFor = closedAt + 90 дней`
- Пишет audit log `tenant_closed`
- Возвращает `{ tenantId, status: 'CLOSED', retentionUntil }`

**`restoreTenant(userId, tenantId)`**
- Проверяет, что tenant в статусе `CLOSED` → иначе `409 TENANT_NOT_CLOSED`
- Проверяет, что пользователь является `primaryOwnerUserId` → иначе `403 TENANT_RESTORE_OWNER_ONLY`
- Проверяет retention window: `closureJob.scheduledFor > now()` → иначе `403 TENANT_RETENTION_WINDOW_EXPIRED`
- В одной транзакции:
  - Обновляет `tenant.status = ACTIVE`, `accessState = SUSPENDED`, `closedAt = null`
  - Создаёт `TenantAccessStateEvent` (CLOSED → SUSPENDED, reasonCode: OWNER_RESTORED)
  - Обновляет `TenantClosureJob.status = ARCHIVED`, `processedAt = now`
- Пишет audit log `tenant_restored`
- Возвращает `{ tenantId, status: 'ACTIVE', accessState: 'SUSPENDED' }`

> Restore выполняет нестандартный переход CLOSED → SUSPENDED напрямую (минуя `assertTransitionAllowed`), т.к. это специальная domain-операция.

### Обновление `listTenants`, `getCurrentTenant`, `getTenant`

Все три метода теперь включают `closureJob: { select: { scheduledFor: true } }` в Prisma include.

### Обновление `formatTenantSummary`

Добавлено поле `retentionUntil: tenant.closureJob?.scheduledFor ?? null`. Frontend получает дедлайн восстановления в tenant picker/history — может отображать CTA "восстановить до [дата]" или "обратитесь в поддержку".

### Новые endpoints в `tenant.controller.ts`

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/tenants/:tenantId/close` | Закрыть tenant (только PRIMARY_OWNER) |
| `POST` | `/tenants/:tenantId/restore` | Восстановить в retention window (только PRIMARY_OWNER) |

### Гарантии модели

- INN остаётся занятым пока `TenantClosureJob.status = PENDING` (уникальный индекс в БД не меняется — ИНН освобождается только при фактическом удалении данных после retention)
- Закрытый tenant видим в `GET /tenants` и `GET /auth/me` (поле `isAvailable: false`, `retentionUntil` для UI)
- Нет "полузакрытого" состояния: закрытие — атомарная транзакция (status + accessState + closureJob)

### Верификация

- `tsc --noEmit` → 0 ошибок.
