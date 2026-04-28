# TASK_NOTIFICATIONS_6 — Frontend Inbox, Read/Unread и Preferences UX

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_NOTIFICATIONS_3`
  - `TASK_NOTIFICATIONS_4`
  - `TASK_NOTIFICATIONS_5`
- Что нужно сделать:
  - собрать inbox UI с read/unread сценариями;
  - показать приоритет, категорию и delivery outcome уведомления;
  - реализовать preferences screen с channels/categories;
  - заранее объяснять, почему некоторые critical alerts нельзя полностью отключить;
  - не выводить UI под `telegram/max` как обязательную часть MVP.
- Критерий закрытия:
  - inbox и настройки каналов читаются без двусмысленности;
  - UX отражает mandatory/optional distinction;
  - интерфейс соответствует MVP-границе `in-app + email`.

---

## Что сделано

### 1. `apps/web/src/api/notifications.ts` — API-клиент

Создан типизированный клиент для работы с backend notifications API:

- **`InboxItem`** — `id, title, message, isRead, createdAt, readAt`
- **`InboxResponse`** — `items, unreadCount, hasMore, nextCursor`
- **`ChannelPrefs`** — `email, in_app, telegram, max` (все boolean)
- **`CategoryPrefs`** — `auth, billing, sync, inventory, referral, system`
- **`NotificationPreferences`** — `tenantId, channels, categories, primaryChannel, isDefault, updatedAt`
- **`notificationsApi.getInbox(params?)`** — GET `/notifications` с cursor, limit, unreadOnly
- **`notificationsApi.markRead(id)`** — PATCH `/notifications/:id/read`
- **`notificationsApi.getPreferences()`** — GET `/notifications/preferences`
- **`notificationsApi.updatePreferences(payload)`** — PATCH `/notifications/preferences`

---

### 2. `apps/web/src/pages/Notifications.tsx` — страница Inbox

Создана полноценная страница уведомлений:

**Фильтры:**
- Вкладки «Все» / «Непрочитанные (N)» — переключение через `filter` state, запрос повторяется через `useCallback`/`useEffect`

**Список уведомлений:**
- Каждый элемент показывает: иконку категории с цветом, заголовок, сообщение, относительное время
- Непрочитанные: синяя точка слева, жирный заголовок, голубой фон-карточка, текст «Прочитано» появляется при hover
- Клик по непрочитанному → `handleMarkRead(id)` → оптимистичный update в state
- Кнопка «Отметить все» вызывает параллельный `Promise.all` для всех непрочитанных

**`getCategoryMeta(title)`** — по ключевым словам заголовка определяет иконку и цвет:
- RefreshCw/amber — синхронизация
- CreditCard/orange — оплата/подписка
- Boxes/blue — остатки/склад
- Gift/purple — реферальная программа
- ShieldCheck/green — безопасность
- AlertTriangle/red — технические инциденты
- Plug/slate — дефолт

**`formatRelativeTime(dateStr)`** — русский относительный формат: «только что», «N мин назад», «N ч назад», «вчера», «N дн назад», локализованная дата.

**Состояния:**
- Loading: спиннер по центру
- Error: красный баннер
- Empty state: Bell-иконка с текстом (разный для all/unread)

---

### 3. `apps/web/src/pages/Settings.tsx` — секция Notification Preferences

Добавлена секция уведомлений, отображается только для Owner (`isOwner && notifPrefs`):

**Mandatory-баннер:**
- Amber-блок с Lock иконкой: «Критичные уведомления безопасности, оплаты и системных сбоев доставляются всегда»

**Каналы доставки:**
- `in_app` — Toggle + бейдж «всегда активен для критичных»
- `email` — Toggle
- `telegram`, `max` — не отображаются (future-ready, вне MVP UI)

**Категории:**
- `auth`, `billing`, `system` — Toggle заблокирован (`disabled`), Lock иконка + пометка «обязательно»
- `sync`, `inventory`, `referral` — полноценный Toggle, управляется пользователем

**Кнопка «Сохранить»:**
- Disabled во время запроса, показывает спиннер
- После успешного сохранения — временный зелёный бейдж «Сохранено» (3 сек)
- При ошибке — показывает toast через общий `message` state

---

### 4. `apps/web/src/layouts/MainLayout.tsx` — Bell в навигации

**Desktop sidebar:**
- NavLink на `/app/notifications` с `Bell` иконкой
- При `unreadCount > 0` — синий badge с числом (max «99+»)

**Mobile bottom nav:**
- NavLink на `/app/notifications` с `Bell` иконкой + badge (max «9+»)
- Подпись «Уведомл.»

**Загрузка счётчика:**
- `useEffect` при наличии `activeTenant` → `notificationsApi.getInbox({ limit: 1, unreadOnly: true })` → `setUnreadCount(r.unreadCount)`
- Ошибка игнорируется (non-critical, badge просто не показывается)

---

### 5. `apps/web/src/App.tsx` — маршрут

Добавлен импорт `Notifications` и маршрут:
```tsx
<Route path="notifications" element={<Notifications />} />
```

---

### Критерии закрытия

- ✅ Inbox: read/unread сценарии, клик-маркировка, «отметить все», фильтры
- ✅ Категории уведомлений визуально различимы (иконки, цвета)
- ✅ Preferences: mandatory categories заблокированы, optional управляются
- ✅ Mandatory-баннер объясняет, почему critical нельзя отключить
- ✅ `telegram`/`max` отсутствуют в UI — MVP-граница `in-app + email` соблюдена
- ✅ Bell с unread badge в обоих навигациях (desktop + mobile)
