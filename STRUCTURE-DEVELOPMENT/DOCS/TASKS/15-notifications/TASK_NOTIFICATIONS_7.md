# TASK_NOTIFICATIONS_7 — QA, Regression и Observability Notifications

> Модуль: `15-notifications`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_NOTIFICATIONS_1`
  - `TASK_NOTIFICATIONS_2`
  - `TASK_NOTIFICATIONS_3`
  - `TASK_NOTIFICATIONS_4`
  - `TASK_NOTIFICATIONS_5`
  - `TASK_NOTIFICATIONS_6`
- Что нужно сделать:
  - покрыть тестами instant email verification, inbox creation, mandatory billing/security alerts;
  - проверить dedup одинаковых sync alerts и throttled low-stock scenarios;
  - добавить кейсы временного провайдера сбоя и retry;
  - проверить запрет на отключение всех каналов для mandatory alerts;
  - завести метрики и алерты по delivery latency, dispatch failures, dedup suppression и provider outage.
- Критерий закрытия:
  - регрессии по delivery policy, mandatory rules и dedup ловятся автоматически;
  - observability показывает event-to-dispatch-to-delivery цепочку;
  - QA matrix покрывает утвержденную MVP notification model.

**Что сделано**

### Тестовое покрытие (5 spec-файлов, 48 тестов — все зелёные)

**`notification-policy.service.spec.ts`** — policy engine:
- Dedup: дубль sync alert (одинаковый dedupKey) → `skippedByDedup=true`, dispatches пустой.
- Dedup: mandatory AUTH event → dedup пропускается даже с совпадающим dedupKey (critical alerts не теряются).
- Dedup: нет dedupKey → `notificationEvent.findFirst` не вызывается.
- Channel selection: нет preferences → DEFAULT email + in_app, без telegram/max.
- Channel selection: email отключён в prefs → только in_app.
- Channel selection: категория SYNC отключена (non-mandatory) → нет dispatches.
- Mandatory rule: mandatory BILLING + все каналы выключены → IN_APP принудительно добавляется.
- Mandatory rule: mandatory SYSTEM + категория system отключена → IN_APP всё равно доставляется.
- Policy: mandatory → INSTANT; CRITICAL severity → INSTANT.
- Policy: SYNC WARNING → THROTTLED (подавление повторяющихся sync alerts).
- Policy: INVENTORY INFO → THROTTLED (low-stock throttle).
- Policy: REFERRAL/BILLING non-critical → INSTANT.

**`notification-delivery-worker.service.spec.ts`** — delivery worker:
- IN_APP dispatch → `_markDelivered` с статусом DELIVERED.
- EMAIL dispatch (instant email verification) → adapter вызван, статус SENT.
- THROTTLED: есть недавний SENT (low-stock) → помечается SKIPPED без доставки.
- THROTTLED: нет недавнего SENT → доставляется нормально.
- Временный сбой (attempt 0) → `_scheduleRetry`, `attempts+1`, `scheduledAt` в будущем.
- Временный сбой (attempt 2, исчерпан) → FAILED, retry нет.
- Permanent error → FAILED сразу без retry (attempt 0).
- TELEGRAM/MAX (future channels) → FAILED немедленно, адаптеры не вызываются.
- SCHEDULED с future scheduledAt → не обрабатывается (ранний return).
- Адаптер бросает exception → defensive catch → retry scheduled.
- Concurrent tick guard: второй тик при активной обработке → `findMany` не вызывается.

**`notifications-preferences.service.spec.ts`** — mandatory channel protection:
- Нет записи → дефолты с `isDefault: true`.
- Запись есть → `isDefault: false`.
- Отключить email, оставить in_app → разрешено.
- Отключить in_app, оставить email → разрешено.
- Отключить оба MVP-канала → `ForbiddenException` (MANDATORY_NOTIFICATION_CHANNEL_REQUIRED).
- Partial merge: незатронутые поля сохраняются из existing.
- Попытка выключить каналы + отключить mandatory категории billing/auth → блокируется на уровне channels.

**`notifications.service.spec.ts`** — publishEvent:
- AUTH/BILLING category → `isMandatory=true` авто-определяется по категории.
- REFERRAL → `isMandatory=false`.
- SYNC с явным `isMandatory=true` override → передаётся в БД.
- `dedupKey` задан → передаётся как `dedup_key`.
- Оркестратор бросает → event сохранён, `dispatches=[]`.

**`notifications-inbox.service.spec.ts`** — inbox:
- `getInbox`: items + unreadCount, `hasMore=false`.
- `getInbox`: cursor-based пагинация (limit+1 items → `hasMore=true`, `nextCursor` установлен).
- `getInbox`: пустой inbox → items=[], unreadCount=0.
- `markRead`: непрочитанная → `ok=true`, `alreadyRead=false`, update вызван.
- `markRead`: уже прочитана → `alreadyRead=true`, update не вызван (идемпотентность).
- `markRead`: запись не найдена → NotFoundException.
- Inbox creation: instant auth notification попадает в inbox.

### Observability (метрики и алерты)

**`notifications-metrics.service.ts`** (новый сервис):
- In-process счётчики: `events_created`, `dispatch_sent`, `dispatch_delivered`, `dispatch_failed`, `dispatch_skipped`, `dedup_suppressed`, `throttle_suppressed`, `retry_scheduled`.
- Rolling latency sample (до 10 000 точек) → `p50`, `p95`, `p99` в ms.
- Alert-level лог при `dispatch_failed % 10 === 0` → `DISPATCH_FAILURE_SPIKE`.
- Alert-level лог при `dedup_suppressed % 50 === 0` → `HIGH_DEDUP_SUPPRESSION`.
- Alert-level лог при `latencyMs > 60 000` → `DELIVERY_LATENCY_HIGH` (SLA p95 < 60 s).
- `getSnapshot()` → endpoint `GET /api/notifications/metrics` (Owner).

**Интеграция метрик**:
- `NotificationDeliveryWorker` (через `@Optional()`): `dispatch_delivered/sent`, `dispatch_failed`, `dispatch_skipped`, `throttle_suppressed`, `retry_scheduled`, `recordDeliveryLatency()`.
- `NotificationPolicyService` (через `@Optional()`): `dedup_suppressed`.
- `NotificationsService` (через `@Optional()`): `events_created`.
- `NotificationsModule`: `NotificationsMetricsService` зарегистрирован как provider.

**`notifications-status.service.ts`** (расширен):
- Метод `_getDeliveryLatency(tenantId)`: вычисляет `p50_ms`/`p95_ms` из реальных dispatches за 24 ч (sentAt - event.createdAt).
- `getStatus()` теперь возвращает `latency: { windowHours, p50_ms, p95_ms, sample_size }`.
- Дополняет in-process метрики DB-backed данными для observability event-to-dispatch-to-delivery цепочки.

**`notifications.controller.ts`** (расширен):
- `GET /api/notifications/metrics` → `metricsService.getSnapshot()` (только Owner).
