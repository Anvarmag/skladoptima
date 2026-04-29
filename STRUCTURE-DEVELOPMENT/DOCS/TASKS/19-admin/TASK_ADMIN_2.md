# TASK_ADMIN_2 — Tenant Directory, Tenant 360 и Summary Read-Model

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_ADMIN_1`
  - согласованы `02-tenant`, `08-marketplace-accounts`, `09-sync`, `18-worker`
- Что нужно сделать:
  - реализовать `GET /api/admin/tenants` и `GET /api/admin/tenants/:tenantId`;
  - собрать tenant directory с поиском по id/name/owner email;
  - построить tenant 360 на summary/read-model, а не на тяжёлых ad hoc joins;
  - включить в tenant 360: team summary, subscription/access state, marketplace accounts, recent sync errors, notifications, worker status, files health, audit summary, notes;
  - обеспечить быстрый и безопасный internal read path.
- Критерий закрытия:
  - tenant 360 помогает диагностировать tenant без ручной реконструкции контекста;
  - summary layer быстрая и устойчивая;
  - internal read-model не смешивается с tenant-facing API.

**Что сделано**

### 1. Tenant directory (`GET /api/admin/tenants`)

[apps/api/src/modules/admin/tenant-directory/tenant-directory.controller.ts](apps/api/src/modules/admin/tenant-directory/tenant-directory.controller.ts) и [tenant-directory.service.ts](apps/api/src/modules/admin/tenant-directory/tenant-directory.service.ts):

- endpoint доступен обеим ролям (`SUPPORT_READONLY` + `SUPPORT_ADMIN`) — без `@AdminRoles`, потому что это диагностическое чтение. Mutating действия поверх directory будут отдельными controllers с `@AdminRoles('SUPPORT_ADMIN')` (T4);
- поиск `q`:
  - если строка соответствует UUID — точное совпадение по `tenant.id` (короткий short-circuit без LIKE и без `lower()`);
  - иначе ILIKE (`mode: 'insensitive'`) по `tenant.name` ИЛИ `primaryOwner.email`;
- фильтры по `status` (TenantStatus) и `accessState` (AccessState) для триажа CLOSED/SUSPENDED/TRIAL_EXPIRED;
- bounded `limit` (`1..100`, default `20`) — read-path безопасен от `give-me-everything`;
- keyset-пагинация по `(createdAt DESC, id DESC)` через opaque base64-cursor — без OFFSET-anti-pattern, который ломается на больших tenant-таблицах;
- ответ возвращает summary-проекцию: `id`, `name`, `inn`, `status`, `accessState`, `closedAt`, `createdAt`, `primaryOwner {id,email}`, `teamSize` (active memberships), `marketplaceAccountsActive` (active accounts). Никаких domain-таблиц-байтов в ответ не утекает;
- `total` отдаётся одним `findMany + count` в `$transaction` — чтобы UI мог показать общий счётчик на странице без второго round-trip.

[dto/list-tenants.dto.ts](apps/api/src/modules/admin/tenant-directory/dto/list-tenants.dto.ts) валидирует все query-параметры через `class-validator` (enum guards для `status`/`accessState`, `MaxLength` для `q`, `Min/Max` для `limit`).

### 2. Tenant 360 read-model (`GET /api/admin/tenants/:tenantId`)

[apps/api/src/modules/admin/tenant-360/tenant-360.controller.ts](apps/api/src/modules/admin/tenant-360/tenant-360.controller.ts) и [tenant-summary.service.ts](apps/api/src/modules/admin/tenant-360/tenant-summary.service.ts):

- по §18 аналитики цель `p95 < 700ms` — поэтому `getTenant360` ВНУТРИ собирается из 13 параллельных bounded запросов через `Promise.all`, а не через один mega-include на `Tenant`. Это отделяет latency сложных областей друг от друга и не зависит от размера tenant'а: каждый запрос имеет `take: 5..20` или `_count`/`groupBy`-агрегаты;
- 404 → `ADMIN_TENANT_NOT_FOUND`, валидация формата UUID на controller-слое → `ADMIN_TENANT_ID_INVALID` (отдельный namespace от tenant-facing ошибок).

Состав ответа покрывает все 10 областей из §14 аналитики:

| Область §14 | Что отдаётся | Источник |
|------|------|------|
| tenant core data | `core` (id/name/inn/status/accessState/timestamps + settings + closureJob) | `Tenant`, `TenantSettings`, `TenantClosureJob` |
| owner и team summary | `owner`, `team {total/active/revoked/left, byRole, recentMembers}`, `invitations {PENDING/ACCEPTED/...}` | `User` (primaryOwner), `Membership` (groupBy + take 5), `Invitation` (groupBy) |
| subscription/access state | `subscription {accessState, tenantStatus, closedAt, history[5]}` | `Tenant`, `TenantAccessStateEvent` |
| marketplace accounts | `marketplaceAccounts[20]` с lifecycle/credential/syncHealth + последняя ошибка | `MarketplaceAccount` |
| recent sync errors | `sync.recentRuns[5]`, `sync.failedRunsLast7d`, `sync.openConflicts` | `SyncRun`, `SyncConflict` |
| recent notifications | `notifications.recent[5]`, `notifications.severityCountsLast7d` | `NotificationEvent` |
| worker status | `worker.statusCounts`, `worker.recentFailed[5]` | `WorkerJob` |
| files health | `files.statusCounts`, `files.totalSizeBytes` (BigInt → string) | `File` |
| audit summary | `audit.totalEvents`, `audit.eventsLast7d`, `audit.recent[10]` | `AuditLog` |
| internal notes | `notes {status: 'pending_t4', items: []}` | stub до T4 |

Дополнительно отдаются `securityEvents[5]` из tenant-facing `SecurityEvent` — для триажа auth-инцидентов (по §3 «recent failed logins»). Admin-плоскость использует ТОЛЬКО read-доступ, mutating action по этим записям невозможен через directory/360.

### 3. Изоляция от tenant-facing контура

Оба новых controller'а оформлены композитом **`@AdminEndpoint() + @UseGuards(AdminAuthGuard)`** — тем же паттерном, что закрепил T1:

- `@AdminEndpoint()` ставит флаги `IS_PUBLIC_KEY` / `SKIP_CSRF_KEY` / `SKIP_TENANT_GUARD_KEY`, чтобы global tenant `JwtAuthGuard`, `CsrfGuard` и `ActiveTenantGuard` пропустили эндпоинт;
- безопасность обеспечивается локальным `AdminAuthGuard` — JWT с `audience: 'admin'`, отдельный `admin-csrf-token` для unsafe методов, RBAC через `@AdminRoles` (T2 не требует mutating-уровня, поэтому только base auth);
- support-actor получает `request.supportUser = { id, role, sessionId }` без `tenantId` — у него нет tenant picker (§T1.4 invariant сохранён).

Ни один из новых endpoints не дёргает tenant-facing `AuthService`, не пишет в доменные таблицы и не предоставляет SQL-like доступ — только чтение через Prisma `select`/`groupBy`/`aggregate`.

### 4. Почему это «summary read-model»

В аналитике §18 read-model названа явно как противопоставление «дорогим ad hoc join». В MVP это ещё не материализованная view, но реализация уже даёт три ключевых свойства настоящего read-model:

1. **Bounded-by-design.** Каждый запрос либо агрегат (`_count`, `groupBy`, `aggregate`), либо `take: 5..20`. Невозможно получить «всё» по тяжёлым таблицам (sync_run_items, audit_logs).
2. **Projection-only ответы.** Через `select` отдаются только summary-поля, никакого case-by-case `include`. Tenant 360 нельзя «расширить» новой колонкой без явного изменения сервиса — это блокирует добавление полей-«серых зон».
3. **Single read-path.** Весь `19-admin` ходит за tenant-данными через `TenantDirectoryService` и `TenantSummaryService`. Когда возникнет необходимость в materialized view (post-MVP), её можно подставить точечно: контракт API не меняется.

Это удовлетворяет §20 риск «admin превращается в дырку мимо доменных контрактов»: всё чтение — через Prisma summary-проекции, а не SQL-like patch.

### 5. Endpoint contract

| Метод | Endpoint | Роль | Тело ответа |
|------|----------|------|-------------|
| `GET` | `/api/admin/tenants` | SUPPORT_READONLY/SUPPORT_ADMIN | `{ items[], nextCursor, total }` |
| `GET` | `/api/admin/tenants/:tenantId` | SUPPORT_READONLY/SUPPORT_ADMIN | tenant 360 summary (см. выше) |

Query для directory: `?q=...&accessState=...&status=...&limit=20&cursor=...`. Cursor opaque (base64url), его пользователь не разбирает.

### 6. Что НЕ сделано в этой задаче (по плану)

- support actions (`POST /api/admin/tenants/:id/actions/*`) — T4;
- internal notes (`support_notes` таблица + CRUD) — T4. В tenant 360 уже есть stable-shape поле `notes.status='pending_t4'`, чтобы UI/front не ломался при появлении T4;
- frontend admin-панель — T5/T6;
- security review high-risk операций — T7.

### 7. Проверки

- `npx tsc --noEmit`: модуль `admin/` чистый. Проверено `npx tsc --noEmit | grep -E "admin|tenant-360|tenant-directory"` — пусто. Все оставшиеся 18 ошибок (catalog/inventory/sync-runs/test-fbo/update-pwd) — pre-existing и не связаны с T2.
- Ручная проверка контракта controller'ов:
  - `@AdminEndpoint()` присутствует на обоих → tenant-facing auth bypassed by design;
  - `@UseGuards(AdminAuthGuard)` присутствует на обоих → admin auth обязателен;
  - DTO `ListTenantsDto` валидирует все query-параметры → защита от SQL-injection через `q` обеспечивается Prisma + `class-validator`.

### 8. Эффект для теста-матрицы аналитики (§16)

| Сценарий | Покрытие T2 |
|------|------|
| Поиск tenant по имени | `GET /api/admin/tenants?q=Foo` → ILIKE по `name` |
| Поиск tenant по owner email | `GET /api/admin/tenants?q=user@example.com` → ILIKE по `primaryOwner.email` |
| Поиск tenant по UUID | `GET /api/admin/tenants?q=<uuid>` → exact match |
| SUPPORT_READONLY открывает tenant 360 | `GET /api/admin/tenants/:id` → 200 без `@AdminRoles` |
| Чужой/несуществующий tenant | 404 `ADMIN_TENANT_NOT_FOUND` |
| Не-UUID в `:tenantId` | 400 `ADMIN_TENANT_ID_INVALID` |

Mutating-сценарии матрицы (trial extend, restore, password reset) переходят в T4 — после слияния T2 контракт directory/360 уже зафиксирован.
