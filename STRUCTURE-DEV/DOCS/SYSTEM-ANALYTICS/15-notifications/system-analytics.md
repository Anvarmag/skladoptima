# Уведомления — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль формирует и доставляет уведомления по событиям системы через каналы `email`, `in-app`, `telegram`, `max`, с поддержкой instant/digest/scheduled и dedup/throttle.

## 2. Функциональный контур и границы

### Что входит в модуль
- формирование notification events по доменным триггерам;
- выбор канала и delivery policy;
- очереди отправки, retries, dedup и throttling;
- in-app inbox и внешние каналы (email/TG/Max по roadmap);
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

## 5. Зависимости и интеграции

- Auth, Billing, Sync, Inventory, Referrals
- Worker queue
- Email provider, Telegram Bot API, Max API

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/notifications` | User | Лента in-app уведомлений |
| `PATCH` | `/api/v1/notifications/:id/read` | User | Пометить как прочитанное |
| `GET` | `/api/v1/notifications/preferences` | Owner | Текущие настройки каналов |
| `PATCH` | `/api/v1/notifications/preferences` | Owner | Обновить настройки |
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

## 8. Модель данных (PostgreSQL)

### `notification_events`
- `id UUID PK`, `tenant_id UUID`, `category`, `severity`
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
- `digest_time TIME NULL`, `timezone VARCHAR(64)`
- `updated_at`

### `notification_inbox`
- `id UUID PK`, `tenant_id UUID`, `user_id UUID`
- `title TEXT`, `message TEXT`, `is_read BOOLEAN`, `created_at`, `read_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Бизнес-модуль публикует внутреннее notification event.
2. Notification service применяет preferences + dedup policy.
3. Создаются dispatch-задачи по каналам и policy.
4. Worker отправляет сообщения, делает retry для временных ошибок.
5. Для in-app создается запись в `notification_inbox`.
6. Digest scheduler формирует сводки по расписанию.

## 10. Валидации и ошибки

- Dedup окно для одинаковых ошибок sync (например, 15 минут).
- Не пытаться отправлять в канал без валидной конфигурации.
- Ошибки:
  - `VALIDATION_ERROR: INVALID_PREFERENCES_PAYLOAD`
  - `CONFLICT: CHANNEL_NOT_CONFIGURED`
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

## 14. Delivery policy engine

### Policy types
- `INSTANT`
- `DIGEST`
- `SCHEDULED`
- `THROTTLED`

### Примеры
- verification/reset/invite -> `INSTANT`
- low stock summary -> `DIGEST`
- trial ending -> `SCHEDULED`
- повторяющиеся sync errors -> `THROTTLED`

## 15. Async и retry

- dispatch всегда через worker
- временные ошибки каналов -> retry with backoff
- permanent failure -> `failed` + visible diagnostics
- dedup window хранится на уровне `dedup_key + category + tenant`

## 16. Тестовая матрица

- Мгновенная отправка email verification.
- Dedup одинаковых sync alerts.
- Daily digest по low stock.
- Ошибка Telegram channel config.
- In-app inbox creation.
- Retry после временного сбоя провайдера.

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
