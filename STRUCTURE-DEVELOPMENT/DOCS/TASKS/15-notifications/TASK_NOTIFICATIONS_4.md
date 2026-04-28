# TASK_NOTIFICATIONS_4 — Preferences API, Inbox API и Channel Status Surfaces

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_NOTIFICATIONS_1`
  - `TASK_NOTIFICATIONS_2`
  - `TASK_NOTIFICATIONS_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/notifications`, `PATCH /api/v1/notifications/:id/read`;
  - реализовать `GET/PATCH /api/v1/notifications/preferences`;
  - реализовать `GET /api/v1/notifications/status`;
  - валидировать preferences payload и запрет на полное отключение mandatory alerts;
  - подготовить status surfaces для channel health и configuration readiness.
- Критерий закрытия:
  - inbox и preferences покрыты стабильным API;
  - owner получает управляемые настройки в допустимых пределах;
  - статус каналов и delivery health объясним для пользователя и support.

**Что сделано**

Реализован полный REST API слой модуля уведомлений: inbox, preferences и channel status surfaces.

### Призма client

Перед реализацией обнаружено, что Prisma client не был регенерирован после TASK_NOTIFICATIONS_1.
Запущен `npx prisma generate` — сгенерированы все notification-модели и enum'ы из `schema.prisma`.
Установлен `@nestjs/schedule` (был в `package.json`, но не установлен в workspaces hoisted node_modules).

### Файловая структура

Добавлено 5 новых файлов в [apps/api/src/modules/notifications/](../../../../../apps/api/src/modules/notifications/):

```
notifications/
├── dto/
│   ├── list-inbox.query.dto.ts          — query params для GET inbox (pagination)
│   └── update-preferences.dto.ts        — body для PATCH preferences (nested DTOs)
├── notifications-inbox.service.ts        — inbox feed + mark read
├── notifications-preferences.service.ts  — get/update preferences с mandatory validation
├── notifications-status.service.ts       — channel health + delivery stats
└── notifications.controller.ts           — 5 REST endpoints
```

`notifications.module.ts` обновлён: добавлены контроллер и 3 новых провайдера.

### 1. dto/list-inbox.query.dto.ts

Query DTO для `GET /api/notifications`:
- `unreadOnly?: boolean` — фильтр непрочитанных (`@Transform` из string `"true"`).
- `limit?: number` — page size 1–100 (default 20 в сервисе).
- `cursor?: string` — ISO-строка `createdAt` последнего элемента (cursor-based pagination).

### 2. dto/update-preferences.dto.ts

Три вложенных DTO с `@ValidateNested` + `@Type`:
- **`ChannelPreferencesDto`** — `email`, `in_app`, `telegram`, `max` (все `@IsOptional @IsBoolean`). Ключи lowercase с underscore — совпадают с JSONB-ключами в БД.
- **`CategoryPreferencesDto`** — `auth`, `billing`, `sync`, `inventory`, `referral`, `system`.
- **`UpdatePreferencesDto`** — `channels?`, `categories?`, `primaryChannel?` (enum).

### 3. NotificationsInboxService

**`getInbox(params)`** — cursor-based feed:
- Фильтрует по `tenantId + userId` (tenant isolation + user isolation).
- `cursor` — точка разрыва страниц по `createdAt < cursor`.
- Запрашивает `limit + 1` элементов для определения `hasMore`.
- Параллельно считает `unreadCount` для badge.
- Возвращает: `{ items, unreadCount, hasMore, nextCursor }`.

**`markRead(params)`**:
- Проверяет ownership через `findFirst({ where: { id, tenantId, userId } })`.
- `NotFoundException` если элемент не принадлежит пользователю (404).
- Идемпотентный: `alreadyRead: true` если уже прочитано.
- При отметке записывает `readAt: now`.

### 4. NotificationsPreferencesService

**`getPreferences(tenantId)`**:
- Если записи нет → возвращает defaults с `isDefault: true` (не создаёт запись).

**`updatePreferences(tenantId, dto)`**:
- Partial merge: только отправленные поля перезаписывают текущие.
- **Mandatory validation (§10)**: после слияния хотя бы один MVP-канал (`email` или `in_app`) должен быть `true`. Иначе → `ForbiddenException({ code: 'MANDATORY_NOTIFICATION_CHANNEL_REQUIRED' })`.
- Upsert-семантика: создаёт запись при первом вызове.
- Возвращает обновлённые preferences + `updated: true`.

### 5. NotificationsStatusService

**`getStatus(tenantId)`** → `{ channels, delivery, preferencesUpdatedAt }`:

**Channel surfaces:**
- `in_app`: всегда `configured: true`, `status: 'active'|'disabled'`.
- `email`: `configured` определяется по env (`SMTP_HOST / EMAIL_PROVIDER / SENDGRID_API_KEY`). Статус `'stub'` пока провайдер не задан — сигнал для support/admin.
- `telegram/max`: `configured: false`, `status: 'unconfigured'` (future-ready).

**Delivery health** — `groupBy(status)` по dispatches tenant'а за последние 24 часа:
- Счётчики: `queued`, `sent`, `delivered`, `failed`, `skipped`.
- `windowHours: 24` — явно указывает временное окно.

### 6. NotificationsController

Маршруты (глобальный prefix `/api`):

| Метод | Путь | Auth | Назначение |
|------|------|------|------------|
| `GET` | `/api/notifications` | User + active tenant | Inbox feed |
| `GET` | `/api/notifications/preferences` | Owner | Текущие настройки |
| `PATCH` | `/api/notifications/preferences` | Owner | Обновить настройки |
| `GET` | `/api/notifications/status` | Owner | Channel health + delivery |
| `PATCH` | `/api/notifications/:id/read` | User + active tenant | Пометить прочитанным |

**Порядок объявления маршрутов**: literal-маршруты (`preferences`, `status`) объявлены раньше параметризованного (`:id/read`) — NestJS не интерпретирует их как `:id`.

**Owner check** — `_assertOwner()`: запрашивает `membership WHERE tenantId+userId+ACTIVE`, проверяет `role === OWNER`. Код ошибки: `ROLE_FORBIDDEN` (403).

**Guards**: `@UseGuards(RequireActiveTenantGuard)` на классе (активный tenant обязателен для всех endpoint'ов).

### Критерии закрытия

- ✅ `GET /api/notifications` — inbox feed с cursor-based pagination и unreadCount.
- ✅ `PATCH /api/notifications/:id/read` — mark read с ownership проверкой и idempotency.
- ✅ `GET /api/notifications/preferences` — текущие настройки с defaults fallback.
- ✅ `PATCH /api/notifications/preferences` — partial merge с mandatory channel validation.
- ✅ `GET /api/notifications/status` — channel health surfaces + delivery stats за 24ч.
- ✅ Mandatory rule (§10): нельзя отключить все MVP-каналы (email + in_app) одновременно.
- ✅ Owner-only ограничения для preferences и status endpoint'ов.
