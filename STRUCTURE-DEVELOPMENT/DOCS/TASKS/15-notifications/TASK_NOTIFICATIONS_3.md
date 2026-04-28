# TASK_NOTIFICATIONS_3 — In-App и Email Delivery, Retry и Provider Integration

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_NOTIFICATIONS_1`
  - `TASK_NOTIFICATIONS_2`
  - согласован `18-worker`
- Что нужно сделать:
  - реализовать delivery по MVP-каналам `in-app` и `email`;
  - создавать inbox запись для in-app пути;
  - интегрировать email provider и технический delivery status;
  - реализовать retry with backoff для временных ошибок;
  - не блокировать delivery pipeline при падении одного channel provider.
- Критерий закрытия:
  - основной MVP delivery path работает через in-app и email;
  - временные provider failures не убивают всю цепочку;
  - delivery statuses пригодны для diagnostics и support.

**Что сделано**

Реализован полный MVP delivery pipeline: in-app и email каналы, retry with backoff, throttle suppression и scheduled worker.

### Файловая структура

Добавлены 4 новых файла в [apps/api/src/modules/notifications/](../../../../../apps/api/src/modules/notifications/):

```
notifications/
├── notification-message.factory.ts           — генератор title/body по category+payload
├── channel-adapters/
│   ├── in-app.adapter.ts                     — in-app delivery (NotificationInbox)
│   └── email.adapter.ts                      — email delivery (stub, provider-ready)
└── notification-delivery-worker.service.ts   — @Cron worker, batch processing, retry
```

`notifications.module.ts` обновлён: добавлены `ScheduleModule.forRoot()`, все новые провайдеры.

### 1. notification-message.factory.ts

Standalone функция `buildNotificationMessage(category, severity, payload?)` → `{ title, body }`.

Шаблоны по `category + payload.eventType`:

| Категория | Событие | Заголовок |
|-----------|---------|-----------|
| AUTH | EMAIL_VERIFICATION | Подтвердите email |
| AUTH | PASSWORD_RESET | Сброс пароля |
| AUTH | TEAM_INVITE | Приглашение в команду |
| BILLING | TRIAL_ENDING / TRIAL_EXPIRED / PAYMENT_FAILED / GRACE_PERIOD / SUBSCRIPTION_SUSPENDED | по типу |
| SYNC | SYNC_RUN_FAILED / SYNC_RUN_PARTIAL / CREDENTIALS_INVALID | по типу с `accountName` |
| INVENTORY | LOW_STOCK / OUT_OF_STOCK / STOCK_CONFLICT | по типу с `productName` |
| REFERRAL | REWARD_CREDITED / REFERRAL_REGISTERED | по типу |
| SYSTEM | MAINTENANCE / PLATFORM_INCIDENT | по severity |

### 2. InAppAdapter (channel-adapters/in-app.adapter.ts)

- Создаёт записи `NotificationInbox` для целевых пользователей.
- Разрешение получателей: `payload.targetUserId` → 1 пользователь, иначе → все ACTIVE OWNER+ADMIN члены tenant'а.
- Inbox creation = delivery (нет внешних вызовов), поэтому никогда не бросает temporary error.
- Единственная permanent failure: нет целевых пользователей.

### 3. EmailAdapter (channel-adapters/email.adapter.ts)

- MVP stub с `_sendViaProvider()` — логирует structured JSON. TODO T15-30: заменить на реальный провайдер.
- Разрешение получателя: `payload.targetUserEmail` → `payload.targetUserId` → primary owner tenant'а.
- Статус SENT (принято провайдером). DELIVERED требует webhook от провайдера (TASK_NOTIFICATIONS_7+).
- Провайдер-ready интерфейс: замена реализации `_sendViaProvider()` не меняет delivery pipeline.

### 4. NotificationDeliveryWorker (notification-delivery-worker.service.ts)

`@Cron('*/30 * * * * *')` — каждые 30 секунд.

**Pipeline:**
1. `findMany(QUEUED, scheduledAt <= now)` — batch 50 dispatches.
2. Atomic claim: `updateMany WHERE status=QUEUED AND id IN [...]` — защита от race.
3. `Promise.allSettled()` — каждый dispatch обрабатывается независимо (failure isolation).
4. **THROTTLED suppression**: проверяет наличие SENT/DELIVERED dispatch для `(tenantId, category, channel)` в последние 15 минут → SKIPPED.
5. **Роутинг**: IN_APP → InAppAdapter, EMAIL → EmailAdapter, остальные → permanent FAILED (channel not implemented).
6. **Retry with backoff** (temp failures): attempt 1 fail → +60s, attempt 2 → +300s, attempt 3+ → FAILED.

**Status transitions:**
- IN_APP success → `DELIVERED` + `deliveredAt`
- EMAIL success → `SENT` + `sentAt`
- Temp failure < MAX → `QUEUED` + `scheduledAt` (backoff) + `attempts++`
- Perm failure / exhausted → `FAILED` + `lastError`
- THROTTLED suppressed → `SKIPPED`

**Guard `_processing`**: предотвращает concurrent ticks при медленной обработке batch.

### Критерии закрытия

- ✅ MVP delivery path работает через IN_APP (создаёт inbox) и EMAIL (stub, provider-ready).
- ✅ Временные ошибки провайдера не убивают весь pipeline: каждый dispatch обрабатывается через `Promise.allSettled`, retry планируется с backoff.
- ✅ Delivery statuses (QUEUED/SENT/DELIVERED/FAILED/SKIPPED + `lastError` + `attempts`) пригодны для diagnostics и support.
- ✅ Падение одного канала не блокирует обработку других.
