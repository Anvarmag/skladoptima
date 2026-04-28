# TASK_NOTIFICATIONS_5 — Dedup, Throttle, Tenant-Safe Policy и Future Channel Boundaries

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_NOTIFICATIONS_2`
  - `TASK_NOTIFICATIONS_3`
  - `TASK_NOTIFICATIONS_4`
- Что нужно сделать:
  - реализовать dedup окно по `dedup_key + category + tenant`;
  - реализовать throttling для повторяющихся sync/inventory alerts;
  - не позволять tenant preferences обходить mandatory delivery policy;
  - закрепить `telegram/max` как future-ready границу, без обязательной реализации в MVP;
  - описать совместимость future channels с текущей unified status model.
- Критерий закрытия:
  - повторяющиеся уведомления не превращаются в спам;
  - tenant-safe policy одинакова для всех entrypoints;
  - граница MVP и future channels зафиксирована без архитектурных противоречий.

**Что сделано**

При аудите реализации обнаружены два бага и несколько архитектурных неточностей, которые были исправлены.

---

### Баг 1 (Критический): DEFAULT_CHANNEL_PREFERENCES с uppercase ключами

**Проблема.** В [notification.contract.ts](../../../../../apps/api/src/modules/notifications/notification.contract.ts) defaults были определены как `Record<NotificationChannel, boolean>` с Prisma-enum ключами:
```typescript
// БЫЛ0:
[NotificationChannel.EMAIL]: true  // key = "EMAIL"
[NotificationChannel.IN_APP]: true // key = "IN_APP"
```

В `_selectChannels` policy service делает `channel.toLowerCase()` → `"email"`, `"in_app"` и ищет `channelPrefs["email"]`. При отсутствии записи `NotificationPreferences` fallback возвращал объект с UPPERCASE ключами, `channelPrefs["email"]` был `undefined`, `?? false` → `false`. **Результат**: для тенантов без сохранённых preferences все не-mandatory события (SYNC, INVENTORY, REFERRAL) молча не создавали dispatches и не доставлялись.

**Исправление.** Изменены типы и ключи defaults на строгий lowercase, совпадающий с JSONB-дефолтами в schema.prisma:
```typescript
// СТАЛО:
export const DEFAULT_CHANNEL_PREFERENCES: Record<string, boolean> = {
    email: true, in_app: true, telegram: false, max: false,
};
export const DEFAULT_CATEGORY_PREFERENCES: Record<string, boolean> = {
    auth: true, billing: true, sync: true, inventory: true, referral: true, system: true,
};
```

Убраны type casts `as Record<string, boolean>` / `as unknown as Record<string, boolean>` из `notification-policy.service.ts`, `notifications-preferences.service.ts`, `notifications-status.service.ts` — они были нужны именно из-за неправильного типа.

---

### Баг 2 (Предупреждение TypeScript): redundant severity check в `_assignPolicy`

**Проблема.** В `_assignPolicy`:
```typescript
// БЫЛ0:
if (isMandatory || severity === CRITICAL) return INSTANT; // severity narrowed to INFO|WARNING
if (THROTTLED_CATEGORIES.has(category) && severity !== CRITICAL) { // ← всегда true!
```

После раннего return TypeScript narrowing делал `severity !== CRITICAL` тавтологией. Это генерировало предупреждение компилятора и вводило читателей в заблуждение.

**Исправление.** Удалено условие `severity !== CRITICAL`:
```typescript
// СТАЛО:
if (THROTTLED_CATEGORIES.has(category)) {  // severity = INFO|WARNING на этом этапе
    return THROTTLED;
}
```

---

### Улучшение 1: `THROTTLE_WINDOW_MS` — явная отдельная константа

**Проблема.** Delivery worker использовал `DEDUP_WINDOW_MS` для подавления throttle-dispatches — смешивал две разные концепции (dedup событий и throttle доставки) под одной константой.

**Исправление.** Добавлена отдельная константа `THROTTLE_WINDOW_MS = 15 * 60 * 1000` с комментарием, что значение намеренно совпадает с `DEDUP_WINDOW_MS` (унифицированное окно), но может меняться независимо. Worker использует `THROTTLE_WINDOW_MS`.

---

### Улучшение 2: `FUTURE_CHANNELS` — явная граница MVP

**Проблема.** TELEGRAM и MAX присутствовали в Prisma enum и коде, но нигде явно не маркировались как «не реализованы». Комментарии были разбросаны по разным файлам.

**Исправление.** Добавлена константа:
```typescript
export const FUTURE_CHANNELS: ReadonlySet<NotificationChannel> = new Set([
    NotificationChannel.TELEGRAM,
    NotificationChannel.MAX,
]);
```

В delivery worker в default-ветке `_route` теперь логируется `isFutureChannel: true` для каналов из `FUTURE_CHANNELS`. Граница MVP зафиксирована в одном месте: чтобы добавить Telegram, нужно реализовать адаптер и перенести из `FUTURE_CHANNELS` в `MVP_CHANNELS`.

---

### Убран неиспользуемый импорт `Prisma`

В `notification-delivery-worker.service.ts` был импорт `Prisma` из `@prisma/client`, который нигде не использовался. Удалён.

---

### Критерии закрытия

- ✅ Dedup работает корректно для всех тенантов, включая без сохранённых preferences.
- ✅ Throttle использует именованную `THROTTLE_WINDOW_MS` константу (не чужую DEDUP_WINDOW_MS).
- ✅ Mandatory policy одинакова для всех entrypoints: defaults работают корректно, mandatory IN_APP гарантирован всегда.
- ✅ TELEGRAM/MAX явно зафиксированы как `FUTURE_CHANNELS` — граница MVP без архитектурных противоречий.
- ✅ TypeScript: ноль ошибок в notification модуле.
