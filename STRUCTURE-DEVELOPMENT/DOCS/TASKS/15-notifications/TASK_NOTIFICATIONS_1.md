# TASK_NOTIFICATIONS_1 — Events, Dispatches, Inbox и Preferences Data Model

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `15-notifications`
  - согласованы `01-auth`, `13-billing`, `09-sync`
- Что нужно сделать:
  - завести `notification_events`, `notification_dispatches`, `notification_preferences`, `notification_inbox`;
  - закрепить категории `AUTH`, `BILLING`, `SYNC`, `INVENTORY`, `REFERRAL`, `SYSTEM`;
  - описать поля `is_mandatory`, `dedup_key`, `policy`, `status`, `attempts`, `read_at`;
  - предусмотреть tenant-level preferences с channels/categories и primary channel;
  - согласовать data model с worker pipeline и in-app inbox UX.
- Критерий закрытия:
  - data model покрывает event, dispatch, delivery и inbox слои;
  - mandatory и optional notifications различаются на уровне модели;
  - preferences и inbox пригодны для API и UX без обходных структур.

**Что сделано**

Реализована полная data model для модуля уведомлений согласно системной аналитике §8 и §13.

### 1. Prisma schema — enums

Добавлено 5 новых enum'ов в [apps/api/prisma/schema.prisma](../../../../../apps/api/prisma/schema.prisma):

- **`NotificationCategory`** — AUTH, BILLING, SYNC, INVENTORY, REFERRAL, SYSTEM. Совпадает с §13 аналитики. Категории AUTH/BILLING/SYSTEM участвуют в mandatory protection на уровне сервиса.
- **`NotificationChannel`** — EMAIL, IN_APP, TELEGRAM, MAX. MVP-каналы: EMAIL + IN_APP (§22); TELEGRAM/MAX future-ready.
- **`NotificationSeverity`** — INFO, WARNING, CRITICAL. CRITICAL усиливает mandatory delivery policy.
- **`NotificationDispatchPolicy`** — INSTANT, DIGEST, SCHEDULED, THROTTLED. DIGEST не входит в MVP (§22), но enum future-compatible.
- **`NotificationDispatchStatus`** — QUEUED, SENT, DELIVERED, FAILED, SKIPPED. SKIPPED — dedup/preferences подавили событие без ошибки.

### 2. Prisma schema — модели

Добавлено 4 модели:

**`NotificationEvent`** — источник уведомления. Ключевые поля:
- `isMandatory: Boolean` — защита AUTH/BILLING/SYSTEM от подавления preferences (§4 сценарий 4, §10).
- `dedup_key: String?` — ключ дедупликации в формате `<category>:<event_type>:<entity_id>`; вместе с `tenantId` + `category` формирует 15-минутное окно dedup (§10, §15).
- `payload: Json?` — контекст для workers (форматирование сообщения).
- Индексы: `(tenantId, category, createdAt)` и `(tenantId, dedup_key, createdAt)`.

**`NotificationDispatch`** — задача доставки по каналу (1 event → N dispatch):
- `channel`, `policy`, `status` — полный lifecycle QUEUED → SENT/DELIVERED/FAILED/SKIPPED.
- `attempts: Int` + `lastError: String?` — retry с backoff (§15 async).
- `scheduledAt`, `sentAt`, `deliveredAt` — временны́е метки для SLA p95 диагностики (§18).
- Индексы: `(channel, status, createdAt)` — worker queue; `(eventId, status)` — retry диагностика.

**`NotificationPreferences`** — tenant-level настройки (owner-managed):
- `channels: Json` — дефолт `{email: true, in_app: true, telegram: false, max: false}`.
- `categories: Json` — дефолт все true (все категории включены).
- `primaryChannel: NotificationChannel` — fallback канал при preferences evaluation.
- `digestTime`, `timezone` — зарезервированы для SCHEDULED policy / будущего DIGEST.
- Enforcement rule §10 (mandatory не отключаются) — на уровне сервиса, не в БД (§20 риск).

**`NotificationInbox`** — in-app inbox, создаётся worker'ом при канале IN_APP (§9 step 6):
- `isRead: Boolean` + `readAt: DateTime?` — UX read/unread и engagement метрики (§7).
- `tenantId` денормализован рядом с `userId` для row-level tenant isolation без join через User.
- Индексы: `(tenantId, userId, isRead, createdAt)` — inbox feed; `(userId, isRead)` — bulk mark-read.

### 3. Relations

- `Tenant` ← `notificationEvents[]`, `notificationPreferences?`, `notificationInboxItems[]`
- `User` ← `notificationInboxItems[]`

### 4. Миграция

Создана аддитивная SQL-миграция [20260428260000_notifications_data_model/migration.sql](../../../../../apps/api/prisma/migrations/20260428260000_notifications_data_model/migration.sql):
- 5 CREATE TYPE для enum'ов.
- 4 CREATE TABLE с FK-constraints и индексами.
- Полностью аддитивна, без ALTER существующих таблиц — безопасна для rolling deploy.
