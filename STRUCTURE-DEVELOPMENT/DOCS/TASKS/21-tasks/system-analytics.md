# Задачи (CRM-like task tracker) — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-28
> Связанный раздел: `21-tasks`

## 1. Назначение модуля

Модуль предоставляет команде продавца лёгкий task-board для проблем, обращений и внутренних поручений: «не доложили клиенту», «уточнить на производстве», «брак — переотправить», «перезвонить покупателю», «свериться по складу». Задача — единая сущность, которую видно в общем inbox'е, можно назначить, прокомментировать, поставить дедлайн и закрыть. Менеджер не лезет в WB-чат / Ozon-чат / Avito по очереди — он создаёт задачу руками за 5 секунд из любого источника.

### Текущее состояние (as-is)

- В системе нет централизованного места под обращения и внутренние поручения. Менеджеры держат их в голове, в личных чатах MAX/Telegram или Excel.
- Связь между конкретным заказом маркетплейса и обращением не отслеживается — после закрытия чата теряется контекст.
- Отсутствует SLA-контроль: дедлайн просрочен — никто не узнает, пока клиент не напомнит сам.

### Целевое состояние (to-be)

- Менеджер за 5 секунд создаёт задачу из любого экрана (включая карточку заказа) или горячей клавишей.
- Задача всегда имеет одного `assignee` (без размытой ответственности), статус и опциональный дедлайн.
- Бот в MAX/Telegram уведомляет ответственного о назначении, новых комментариях и подходящем дедлайне.
- Inbox-вью показывает «мои открытые / просрочено / создал я» — это первый экран после логина для менеджера.
- Связка с Order/Product опциональна: задача про «перезвонить старому клиенту» жива и без привязки.

## 2. Функциональный контур и границы

### Что входит в модуль
- CRUD задач (`Task`).
- Комментарии (`TaskComment`) с разделением INTERNAL / CUSTOMER_FACING (на будущее).
- Audit timeline (`TaskEvent`) — append-only лог всех изменений.
- Inbox / Kanban / детальная карточка во фронте.
- Push в MAX/Telegram через существующий `15-notifications` контур.
- Опциональная связка с `Order` / `Product` (FK nullable).

### Что не входит в модуль
- Полноценный helpdesk с SLA-контрактами, escalation matrices, customer portal.
- Email/SMS-канал общения с клиентом (это `15-notifications` отдельная фаза).
- Time-tracking, sprint planning, dependencies между задачами.
- Webhook-интеграция с маркетплейс-чатами (WB/Ozon/Avito) — задачи создаются вручную.
- Custom fields / конструктор форм / workflow builder.

### Главный результат работы модуля
- Все рабочие "todo's" tenant'а живут в одном месте, имеют ответственного, видны на одном экране и автоматически напоминают о себе.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Менеджер (любая роль) | Создаёт задачи, назначает, комментирует, закрывает | Не может удалять чужие задачи (только архивировать свои, см. §13) |
| Owner / Admin | Видят все задачи tenant'а, могут переназначать | Стандартное role-расширение |
| Бот MAX/Telegram | Доставляет push-уведомления | Не создаёт задачи (в MVP), не модифицирует |
| Система (cron) | Шлёт due-reminders | Не меняет статусы автоматически — overdue это сигнал, а не действие |

## 4. Базовые сценарии использования

### Сценарий 1. Менеджер создаёт задачу по горячей клавише
1. Жмёт `Ctrl+I` (или кнопку "+" в шапке).
2. Появляется modal с одним обязательным полем `title`.
3. Enter → задача создаётся, `assignee = я`, `status = OPEN`.
4. По желанию — раскрывает форму и заполняет category/priority/due/related.

### Сценарий 2. Менеджер создаёт задачу из карточки заказа
1. На странице `/app/orders` открывает заказ.
2. В drawer'е жмёт «Создать задачу по заказу».
3. Modal с предзаполненным `title = "Заказ WB12345 — "`, `relatedOrderId = ord_xxx`, `category = MARKETPLACE_CLIENT_ISSUE`.
4. Указывает assignee и due → создаёт.

### Сценарий 3. Назначение и нотификация
1. Менеджер A назначает задачу на менеджера B.
2. В timeline пишется `ASSIGNED` event.
3. Бот шлёт менеджеру B пуш в MAX (или Telegram, по preference): «Тебе назначена задача "Перезвонить клиенту WB12345"» + deep-link.

### Сценарий 4. Дедлайн подходит
1. У задачи `dueAt = 2026-04-28T18:00`.
2. Cron запускается раз в 10 минут, находит задачи с `dueAt - now < 1h && status NOT IN (DONE, ARCHIVED)`.
3. Шлёт напоминание ассайни ровно один раз (флаг `dueReminderSentAt` чтобы не спамить).
4. После просрочки — отдельный пуш «Задача просрочена» (один раз).

### Сценарий 5. Комментарий в чужой задаче
1. Менеджер B оставил комментарий в задаче, где assignee — менеджер C.
2. В timeline `COMMENTED` event.
3. Пуш менеджеру C: «Новый комментарий в задаче "..."» (с дебаунсом 30 сек на серию).

### Сценарий 6. Tenant в TRIAL_EXPIRED / SUSPENDED / CLOSED
1. Read-доступ к задачам сохраняется (история операций видна).
2. Создание / редактирование / комментирование заблокировано на write-guard'е.
3. Cron-нотификации НЕ шлются (avoid bot-spam при паузе).

## 5. Зависимости и интеграции

- `01-auth` — userId / membership для assignee, createdBy.
- `03-team` — список членов tenant'а для assignee picker.
- `02-tenant` — accessState для write-guard и нотификаций.
- `10-orders` — optional FK на Order (для связки задачи с конкретным заказом).
- `05-catalog` — optional FK на Product.
- `15-notifications` — точка отправки push'ей в MAX/Telegram.
- `16-audit` — append-only TaskEvent совместим с общей audit-моделью (но хранится в собственной таблице — для частоты записи).

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/tasks` | User | Список задач с фильтрами (Inbox views) |
| `GET` | `/api/tasks/:taskId` | User | Деталь задачи + комментарии + timeline |
| `POST` | `/api/tasks` | User (write) | Создать задачу |
| `PATCH` | `/api/tasks/:taskId` | User (write) | Обновить (title/desc/priority/due/category/tags) |
| `POST` | `/api/tasks/:taskId/assign` | User (write) | Назначить assignee |
| `POST` | `/api/tasks/:taskId/status` | User (write) | Сменить статус |
| `POST` | `/api/tasks/:taskId/comments` | User (write) | Добавить комментарий |
| `POST` | `/api/tasks/:taskId/archive` | Owner/Admin или автор | Архивировать |

## 7. Примеры вызова API

```bash
# Inbox: мои открытые
curl '/api/tasks?assignee=me&status=OPEN,IN_PROGRESS,WAITING&page=1&limit=20'

# Создать задачу по заказу
curl -X POST '/api/tasks' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Заказ WB12345 — не доложили товар",
    "category": "MARKETPLACE_CLIENT_ISSUE",
    "priority": "HIGH",
    "assigneeUserId": "usr_abc",
    "relatedOrderId": "ord_xyz",
    "dueAt": "2026-04-28T18:00:00Z"
  }'
```

```json
{
  "id": "tsk_...",
  "title": "Заказ WB12345 — не доложили товар",
  "status": "OPEN",
  "priority": "HIGH",
  "category": "MARKETPLACE_CLIENT_ISSUE",
  "assigneeUserId": "usr_abc",
  "createdByUserId": "usr_me",
  "relatedOrderId": "ord_xyz",
  "relatedProductId": null,
  "tags": [],
  "dueAt": "2026-04-28T18:00:00Z",
  "createdAt": "2026-04-28T10:00:00Z",
  "updatedAt": "2026-04-28T10:00:00Z"
}
```

### Frontend поведение

- Маршрут `/app/tasks` — Inbox + Kanban; первый экран показывает «Мои открытые».
- В шапке glob-плавающая кнопка `+` и hotkey `Ctrl+I` для quick-create.
- Карточка задачи открывается в drawer (как Order Detail Drawer), с inline edit'ом title/status/assignee/due.
- Связка из `/app/orders`: кнопка «Создать задачу по заказу» в drawer'е заказа.
- При paused integration на странице tasks: read-доступ, write-кнопки disabled с tooltip'ом.

## 8. Модель данных (PostgreSQL)

### `Task`
- `id UUID PK`, `tenantId UUID`
- `title VARCHAR(255) NOT NULL`
- `description TEXT NULL` (markdown)
- `category ENUM(marketplace_client_issue, production_inquiry, warehouse, finance, other) DEFAULT 'other'`
- `priority ENUM(low, normal, high, urgent) DEFAULT 'normal'`
- `status ENUM(open, in_progress, waiting, done, archived) DEFAULT 'open'`
- `assigneeUserId UUID NOT NULL` (FK → User; обязательный — задача без ответственного теряет смысл)
- `createdByUserId UUID NOT NULL` (FK → User)
- `dueAt TIMESTAMPTZ NULL`
- `dueReminderSentAt TIMESTAMPTZ NULL` (anti-spam для cron'а)
- `overdueNotifiedAt TIMESTAMPTZ NULL`
- `relatedOrderId UUID NULL` (FK → Order, SET NULL)
- `relatedProductId UUID NULL` (FK → Product, SET NULL)
- `tags TEXT[] DEFAULT '{}'`
- `completedAt TIMESTAMPTZ NULL`
- `archivedAt TIMESTAMPTZ NULL`
- `createdAt`, `updatedAt`
- Индексы: `(tenantId, assigneeUserId, status, dueAt)`, `(tenantId, status, createdAt)`, `(tenantId, createdByUserId, createdAt)`, `(tenantId, relatedOrderId)`, `(tenantId, dueAt) WHERE status NOT IN (done, archived)` (partial для cron).

### `TaskComment`
- `id UUID PK`, `taskId UUID FK CASCADE`
- `authorUserId UUID FK`
- `body TEXT NOT NULL` (markdown)
- `visibility ENUM(internal, customer_facing) DEFAULT 'internal'`
- `createdAt`, `updatedAt`, `editedAt NULL`, `deletedAt NULL` (soft delete)
- Индекс: `(taskId, createdAt)`

### `TaskEvent`
- `id UUID PK`, `tenantId UUID`, `taskId UUID FK CASCADE`
- `actorUserId UUID NULL` (NULL для system event'ов: cron, system close)
- `eventType ENUM(created, updated, assigned, status_changed, commented, due_changed, archived, due_reminder_sent, overdue_notified)`
- `payload JSONB`
- `createdAt`
- Индексы: `(taskId, createdAt)`, `(tenantId, eventType, createdAt)`

## 9. Сценарии и алгоритмы (step-by-step)

1. **Create**: валидируем title/assignee → проверяем membership(assignee, tenant) → создаём `Task` + `TaskEvent(CREATED)` + `TaskEvent(ASSIGNED)` в одной транзакции → enqueue notify ASSIGNED.
2. **Update**: diff'аем поля → пишем `TaskEvent(UPDATED)` с {changedFields}; для смены `assigneeUserId` — отдельный `ASSIGNED` event + notify; для смены `status` — `STATUS_CHANGED` event + (если DONE → `completedAt = now`); для `dueAt` — `DUE_CHANGED` event + сброс `dueReminderSentAt = null` (новый дедлайн = новое окно напоминаний).
3. **Comment**: создаём `TaskComment` + `TaskEvent(COMMENTED)` → notify ассайни, если автор != ассайни (с дебаунсом 30 сек на одного получателя).
4. **Cron due-reminders** (раз в 10 минут): SELECT задачи где `dueAt BETWEEN now AND now+1h AND dueReminderSentAt IS NULL AND status NOT IN (done, archived)` → шлём пуш ассайни → `dueReminderSentAt = now`. Аналогично `overdueNotifiedAt` для просрочки.
5. **Archive**: только OWNER/ADMIN или `createdByUserId === actor`. Меняем `status=ARCHIVED, archivedAt=now`. Удаление физическое не делаем — audit важнее.
6. **Tenant paused** (TRIAL_EXPIRED/SUSPENDED/CLOSED): write-guard отбивает create/update/comment/assign/status/archive с `403 ORDER_INGEST_BLOCKED_BY_TENANT_STATE`-аналогом (`TASK_WRITE_BLOCKED_BY_TENANT_STATE`). Cron-нотификации skipped с structured log'ом.

## 10. Валидации и ошибки

- `title` обязателен, max 255.
- `description` max 10_000 символов.
- `assigneeUserId` обязателен, должен быть active member tenant'а.
- `dueAt` не в прошлом при создании (warning, не блок) — иначе пишем `TaskEvent` с warning payload.
- `relatedOrderId` если указан — должен принадлежать тому же tenant.
- Нельзя сменить статус из терминального `ARCHIVED` (защита от silent overwrite, аналог §20 orders).
- Нельзя удалить чужой комментарий (только soft delete своего).
- Ошибки:
  - `NOT_FOUND: TASK_NOT_FOUND`
  - `FORBIDDEN: TASK_WRITE_BLOCKED_BY_TENANT_STATE`
  - `FORBIDDEN: TASK_ASSIGN_TO_NON_MEMBER`
  - `FORBIDDEN: TASK_ARCHIVE_NOT_ALLOWED`
  - `CONFLICT: TASK_INVALID_STATE_TRANSITION`
  - `BAD_REQUEST: TASK_VALIDATION_FAILED`

## 11. Чеклист реализации

- [ ] Таблицы Task / TaskComment / TaskEvent + миграция.
- [ ] CRUD сервис + state machine + комментарии.
- [ ] REST API + Inbox-фильтры (`assignee=me`, `createdBy=me`, `overdue=true`, `relatedOrderId=...`).
- [ ] Push-нотификации в MAX/Telegram + due/overdue cron.
- [ ] Frontend Inbox + Kanban + drawer + quick-create modal + hotkey + связка из Orders.
- [ ] QA spec'и + observability метрики.

## 12. Критерии готовности (DoD)

- Менеджер за 5 секунд может создать задачу с одним полем title.
- Назначение задачи всегда приводит к push-нотификации ассайни (если включён канал).
- Дедлайн напоминается ровно один раз (без spam'а).
- История изменений задачи полностью трассируема через TaskEvent.
- Paused tenant не теряет историю, но не создаёт новые задачи и нотификации.

## 13. State machine задачи

### Внутренние статусы
- `OPEN` — создана, никто не взялся.
- `IN_PROGRESS` — ассайни активно работает.
- `WAITING` — ждём внешнее (производство / клиент / поставка).
- `DONE` — выполнена.
- `ARCHIVED` — спрятана от inbox'ов; всё ещё в БД для аналитики.

### Основные переходы
- `OPEN → IN_PROGRESS / WAITING / DONE / ARCHIVED`
- `IN_PROGRESS → WAITING / DONE / OPEN`
- `WAITING → IN_PROGRESS / DONE / OPEN`
- `DONE → ARCHIVED / OPEN` (reopen разрешён, audit фиксирует)
- `ARCHIVED → нигде` (терминальное; чтобы вернуть — создаём новую задачу)

### MVP правило
- В Inbox по умолчанию показываются `OPEN / IN_PROGRESS / WAITING`. `DONE` доступен через фильтр «Выполненные за неделю». `ARCHIVED` — только через явный фильтр.
- Любой member tenant'а может менять статус (без role gating для transitions — это гибкий командный инструмент).

## 14. Правила работы с комментариями

- Один комментарий = один `TaskComment` row. Edit пишет `editedAt`, оригинал не пересохраняется (для MVP — без полной истории редакций).
- Soft delete (`deletedAt`) — только своих, и UI показывает «Комментарий удалён».
- `visibility=customer_facing` зарезервирован под будущую интеграцию с маркетплейс-чатами; в MVP всегда `internal`.

## 15. Async и события

### `TaskEvent` типы (см. §8)
- `created`, `updated`, `assigned`, `status_changed`, `commented`, `due_changed`, `archived`, `due_reminder_sent`, `overdue_notified`.

### Background работа
- Cron `taskDueReminderJob` каждые 10 минут — due/overdue notifications.
- Comment-debouncer (in-memory или Redis, MVP in-memory) на 30 сек на (taskId, recipientUserId) для group'инга серии комментариев в один пуш.

## 16. Тестовая матрица

- Создание задачи с минимальным набором полей.
- Назначение задачи члену команды → push отправлен.
- Назначение non-member → 403 TASK_ASSIGN_TO_NON_MEMBER.
- Смена статуса OPEN → DONE → completedAt заполнен.
- Reopen DONE → OPEN разрешён.
- Попытка transition из ARCHIVED → 409 TASK_INVALID_STATE_TRANSITION.
- Комментарий в чужой задаче → push assignee.
- Несколько комментариев подряд за 30 сек → один групповой push.
- Cron due-reminder отправляется один раз (повторный запуск cron'а не шлёт второй пуш).
- Overdue task получает overdueNotified ровно один раз.
- Paused tenant блокирует create/update/comment.
- Paused tenant блокирует cron-нотификации (skipped).
- Inbox-фильтры (`assignee=me`, `overdue=true`, `relatedOrderId=...`) работают и используют индексы.

## 17. Фазы внедрения

1. `Task / TaskComment / TaskEvent` + миграция.
2. CRUD сервис + state machine + комментарии (без push'ей).
3. REST API + Inbox-фильтры + role/preflight guards.
4. Notifications wiring + cron due-reminders.
5. Frontend `/app/tasks` + связка из Orders.
6. QA + observability метрики.

## 18. Нефункциональные требования и SLA

- Quick-create endpoint p95 < 200 мс (без notify — push асинхронный).
- Inbox list endpoint p95 < 400 мс на 1000 активных задач (покрывается partial-индексом).
- Notify через MAX/Telegram доставляется asynchronously, никогда не блокирует API response.
- Cron-нотификации garantirуют at-least-once (но `dueReminderSentAt` гарантирует, что для одного дедлайна — ровно один пуш).

## 19. Observability, логи и алерты

- Метрики:
  - `tasks_created` — counter (per category).
  - `tasks_completed` — counter.
  - `tasks_overdue_active` — gauge (текущее число просроченных открытых).
  - `task_avg_time_to_complete_ms` — histogram.
  - `task_notifications_sent` — counter (per channel: max/telegram).
  - `task_notification_send_failures` — counter.
- Логи: structured JSON для каждого state_changed / assigned / cron-fired.
- Алерты: рост `task_notification_send_failures`, аномальный рост `tasks_overdue_active` (нагрузка превысила способность команды).
- Dashboard: «Inbox by team-member», «Overdue trend», «Time-to-close distribution».

## 20. Риски реализации и архитектурные замечания

- Главный риск: нотификации становятся spam'ом → люди отключают бота → CRM теряет ценность. Защита: дебаунс на комментарии, ровно один due-reminder, user preference на типы пушей (per-user opt-out по eventType).
- Риск гибкого workflow: «давайте добавим custom fields, кастомные статусы, sub-tasks». MVP отказывается от всего этого — иначе превращается в недо-Jira. Если бизнесу понадобится — отдельный roadmap-цикл.
- Риск accidental data loss: archive не делает физическое удаление; full delete только через DB-операцию, не через API.
- Риск race на нотификациях cron: используем `UPDATE Task SET dueReminderSentAt = now() WHERE id = ? AND dueReminderSentAt IS NULL` — атомарная проверка-и-апдейт, повторный cron второй пуш не пошлёт.
- Риск зависимости от существующего `MaxNotifierModule`: если канал недоступен, не блокируем задачу. Notify отправляется в фоне, failure — структурированный лог + counter.

## 21. Открытые вопросы к продукту и архитектуре

- Нужны ли вложения (фото от клиента) в MVP? — Решение: нет, в комментарии markdown-ссылка на внешний source достаточна. Полноценные attachments — после `17-files-s3`.
- Нужны ли подписчики (watchers) кроме assignee? — Нет в MVP, только assignee + author получают пуши.
- Поддержка нескольких assignees? — Нет в MVP, ровно один (избегаем размытой ответственности).

## 22. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 23. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-28 | Первичная аналитика модуля (CRM-like task tracker без маркетплейс-интеграций, с MAX/Telegram нотификациями) | Anvar |
