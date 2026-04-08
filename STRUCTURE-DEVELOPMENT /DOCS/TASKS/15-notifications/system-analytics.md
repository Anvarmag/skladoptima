# Уведомления — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `15-notifications`

## 1. Назначение модуля

Модуль формирует и доставляет уведомления по событиям системы через каналы `email`, `in-app`, `telegram`, `max`, с поддержкой instant/digest/scheduled и dedup/throttle.

### Текущее состояние (as-is)

- в текущем коде нет полноценного notification center и пользовательских preferences;
- присутствует только модуль `max-notifier`, который отражает внешний канал и тестовый/служебный контур;
- единая модель notification events, dispatches и inbox пока описана как следующий слой зрелости продукта.

### Целевое состояние (to-be)

- notifications должны стать самостоятельным delivery слоем с inbox, preferences, dedup и retry;
- обязательные продуктовые триггеры должны доставляться через единый pipeline и быть наблюдаемыми;
- mandatory security/billing/system alerts должны быть отделены от пользовательских preferences и не отключаться полностью;
- каналы доставки должны отделяться от продуктовой семантики уведомления.


## 2. Функциональный контур и границы

### Что входит в модуль
- формирование notification events по доменным триггерам;
- выбор канала и delivery policy;
- очереди отправки, retries, dedup и throttling;
- in-app inbox и внешние каналы (email/TG/Max по roadmap);
- правила mandatory vs optional delivery;
- хранение статусов dispatch/delivery/read.

### Что не входит в модуль
- бизнес-решение о том, нужно ли событие в конкретном модуле без контракта;
- полноценная маркетинговая рассылочная платформа;
- auth-подтверждения как часть credential logic beyond integration point;
- произвольная пользовательская automation engine.

### Главный результат работы модуля
- критичные и информационные события доставляются пользователю предсказуемо, без спама и с возможностью диагностировать любой сбой цепочки доставки.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Доменные модули | Публикуют notification events | Не должны отправлять напрямую в провайдер |
| Notification service | Строит dispatch plan и отслеживает статус | Центральный orchestration layer |
| User | Получает и читает уведомления | Может менять preferences в допустимых пределах |
| Owner | Управляет tenant-level channel preferences | Не отключает mandatory alerts полностью |
| Channel provider | Доставляет сообщение | Источник технического delivery result |

## 4. Базовые сценарии использования

### Сценарий 1. Мгновенное critical уведомление
1. Доменный модуль публикует event с severity.
2. Notification service определяет mandatory policy и канал.
3. Создаются dispatch записи.
4. Worker отправляет сообщение.
5. Результат доставки логируется, при ошибке запускается retry.

### Сценарий 2. Digest уведомление
1. Низкоприоритетные события складываются в digest bucket.
2. По расписанию формируется summary.
3. Пользователь получает один consolidated message вместо нескольких.
4. Digest delivery и open/read трекаются отдельно.

### Сценарий 3. Изменение preferences
1. Пользователь открывает settings.
2. Меняет каналы/категории в пределах разрешенной политики.
3. Backend сохраняет preferences.
4. Будущие dispatch рассчитываются уже с учетом новых настроек.

### Сценарий 4. Mandatory alert при отключенных каналах
1. Возникает security/billing/system-critical событие.
2. Notification service помечает его как mandatory.
3. Пользовательские preferences учитываются только частично: система ищет доступный обязательный канал.
4. Событие попадает минимум в in-app inbox и, при наличии валидной конфигурации, в основной внешний канал.

## 5. Зависимости и интеграции

- Auth, Billing, Sync, Inventory, Referrals
- Team invites
- Worker queue
- Email provider, Telegram Bot API, Max API

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/notifications` | User | Лента in-app уведомлений |
| `PATCH` | `/api/v1/notifications/:id/read` | User | Пометить как прочитанное |
| `GET` | `/api/v1/notifications/preferences` | Owner | Текущие настройки каналов |
| `PATCH` | `/api/v1/notifications/preferences` | Owner | Обновить настройки |
| `GET` | `/api/v1/notifications/status` | Owner | Статус каналов и delivery health |
| `POST` | `/api/v1/notifications/channels/telegram/test` | Owner | Тест Telegram канала |
| `POST` | `/api/v1/notifications/channels/max/test` | Owner | Тест Max канала |
| `POST` | `/api/v1/notifications/internal/dispatch` | Internal | Поставить уведомление в очередь |

## 7. Примеры вызова API

```bash
curl -X PATCH /api/v1/notifications/preferences \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"channels":{"email":true,"telegram":true,"max":false},"categories":{"sync":true,"billing":true,"marketing":false}}'
```

```json
{
  "tenantId": "tnt_...",
  "updated": true,
  "preferencesVersion": 3
}
```

### Frontend поведение

- Текущее состояние: в текущем web-клиенте нет страницы уведомлений и экрана настроек каналов.
- Целевое состояние: нужны inbox, read/unread сценарии и preferences по категориям и каналам.
- UX-правило: пользователь должен понимать приоритет уведомления и иметь управляемые настройки, не отключая критичные системные события.
- В MVP основными каналами считаем `in-app` и `email`; `telegram/max` остаются future-ready внешними каналами.
- Digest-уведомления в MVP не включаются как пользовательская функция; все важные события идут instant/throttled.

## 8. Модель данных (PostgreSQL)

### `notification_events`
- `id UUID PK`, `tenant_id UUID`, `category`, `severity`
- `is_mandatory BOOLEAN NOT NULL DEFAULT false`
- `dedup_key VARCHAR(128)`, `payload JSONB`
- `created_at`

### `notification_dispatches`
- `id UUID PK`, `event_id UUID`, `channel ENUM(email, in_app, telegram, max)`
- `policy ENUM(instant, digest, scheduled)`
- `status ENUM(queued, sent, delivered, failed, skipped)`
- `attempts INT`, `last_error TEXT NULL`
- `scheduled_at TIMESTAMPTZ NULL`, `sent_at`, `delivered_at`

### `notification_preferences`
- `tenant_id UUID PK`
- `channels JSONB`, `categories JSONB`
- `primary_channel ENUM(email, in_app, telegram, max) NULL`
- `digest_time TIME NULL`, `timezone VARCHAR(64)`
- `updated_at`

### `notification_inbox`
- `id UUID PK`, `tenant_id UUID`, `user_id UUID`
- `title TEXT`, `message TEXT`, `is_read BOOLEAN`, `created_at`, `read_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Бизнес-модуль публикует внутреннее notification event.
2. Notification service определяет `category`, `severity`, `is_mandatory`.
3. Применяются preferences + dedup policy, но mandatory alerts не могут быть полностью подавлены.
4. Создаются dispatch-задачи по каналам и policy.
5. Worker отправляет сообщения, делает retry для временных ошибок.
6. Для in-app создается запись в `notification_inbox`.
7. Digest scheduler в MVP не активируется для пользовательского потока.

## 10. Валидации и ошибки

- Dedup окно для одинаковых ошибок sync (например, 15 минут).
- Не пытаться отправлять в канал без валидной конфигурации.
- Preferences не могут выключить mandatory `AUTH/BILLING/SYSTEM` alerts на всех каналах сразу.
- Ошибки:
  - `VALIDATION_ERROR: INVALID_PREFERENCES_PAYLOAD`
  - `CONFLICT: CHANNEL_NOT_CONFIGURED`
  - `FORBIDDEN: MANDATORY_NOTIFICATION_CHANNEL_REQUIRED`
  - `EXTERNAL_INTEGRATION_ERROR: DELIVERY_FAILED`

## 11. Чеклист реализации

- [ ] Таблицы events/dispatch/inbox/preferences.
- [ ] Очереди и retry delivery.
- [ ] API preferences + inbox.
- [ ] Интеграция каналов email/telegram/max.
- [ ] Dedup/throttle политики.

## 12. Критерии готовности (DoD)

- Критичные уведомления доходят в SLA.
- Дубли не спамят пользователя.
- Настройки owner реально влияют на доставку.
- Mandatory alerts не могут быть случайно отключены пользовательской настройкой.

## 13. Категории и каналы доставки

### Категории
- `AUTH`
- `BILLING`
- `SYNC`
- `INVENTORY`
- `REFERRAL`
- `SYSTEM`

### Каналы
- `EMAIL`
- `IN_APP`
- `TELEGRAM`
- `MAX`

### MVP каналы
- `IN_APP`
- `EMAIL`
- `TELEGRAM` и `MAX` остаются future-ready, но не обязательны для первой версии

## 14. Delivery policy engine

### Policy types
- `INSTANT`
- `DIGEST`
- `SCHEDULED`
- `THROTTLED`

### Примеры
- verification/reset/invite -> `INSTANT`
- low stock summary -> `THROTTLED`
- trial ending -> `SCHEDULED`
- повторяющиеся sync errors -> `THROTTLED`

### Mandatory policy MVP
- `AUTH` security и verification/reset/invite delivery -> mandatory;
- `BILLING` trial ending / grace / suspension -> mandatory;
- `SYSTEM` critical incidents -> mandatory;
- `SYNC`, `INVENTORY`, `REFERRAL` могут подчиняться preferences и throttling.

## 15. Async и retry

- dispatch всегда через worker
- временные ошибки каналов -> retry with backoff
- permanent failure -> `failed` + visible diagnostics
- dedup window хранится на уровне `dedup_key + category + tenant`

## 16. Тестовая матрица

- Мгновенная отправка email verification.
- Dedup одинаковых sync alerts.
- Low stock throttled alert без spam-повторов.
- Ошибка Telegram channel config.
- In-app inbox creation.
- Retry после временного сбоя провайдера.
- Попытка выключить все каналы для mandatory billing/security alerts.

## 17. Фазы внедрения

1. Events + dispatch + inbox + preferences.
2. Email and in-app delivery.
3. Telegram/Max adapters.
4. Digest/scheduled engines.
5. Dedup/throttle/retry observability.

## 18. Нефункциональные требования и SLA

- Critical notification path должен обеспечивать доставку/попытку доставки с целевым `p95 < 60 сек` после доменного события.
- Dispatch pipeline должен быть устойчив к повторам событий и поддерживать dedup/throttle rules.
- Падение одного channel provider не должно останавливать остальные каналы.
- Preference evaluation и mandatory-alert policy должны проверяться на backend.
- Для MVP instant/inbox flow приоритетнее digest-функций; digest не должен усложнять критичный delivery path первой версии.

## 19. Observability, логи и алерты

- Метрики: `notification_events_created`, `dispatch_sent`, `dispatch_failed`, `delivery_latency_p95`, `dedup_suppressed`, `digest_generated`.
- Логи: event-to-dispatch mapping, provider responses, retry decisions, preference overrides.
- Алерты: падение delivery success, рост latency critical alerts, массовый provider outage, explosion of duplicates.
- Dashboards: delivery SLA board, provider health, critical alert funnel, digest performance.

## 20. Риски реализации и архитектурные замечания

- Нельзя позволять доменным модулям отправлять уведомления напрямую в каналы, иначе не будет единой политики.
- Нужно четко разделять `event`, `dispatch`, `delivery`, иначе диагностика будет неточной.
- Preferences не должны выключать действительно критичные system-mandated alerts.
- При росте числа каналов важна унифицированная status model, иначе UI и аналитика рассыпятся.
- Если включить сразу много внешних каналов в MVP, операционная сложность и support cost вырастут быстрее пользовательской пользы.

## 21. Открытые вопросы к продукту и архитектуре

- Для MVP открытых product/blocking questions не осталось.

## 22. Подтвержденные решения

- MVP-набор каналов подтвержден как `in-app + email`.
- `telegram` и `max` остаются future-ready и не входят в обязательный запуск первой версии.
- Digest-уведомления не входят в MVP.
- Первая версия живет на `instant / scheduled / throttled`.

## 23. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 24. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены mandatory policy, MVP channel scope и открытые решения по digest/channel set | Codex |
| 2026-04-18 | Зафиксированы confirmed decisions по MVP-каналам и отказу от digest в первой версии | Codex |
