# TASK_ORDERS_6 — Frontend Orders UX и Diagnostics

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_ORDERS_3`
  - `TASK_ORDERS_4`
  - `TASK_ORDERS_5`
- Что нужно сделать:
  - расширить `/app/orders` фильтрами, внутренними статусами и stock-effect indicators;
  - собрать карточку заказа и timeline событий;
  - показывать, влияет ли заказ на stock и применился ли side-effect успешно;
  - объяснить `UNRESOLVED`, `unmatched SKU`, `warehouse scope missing`, `blocked stock effect`;
  - при `TRIAL_EXPIRED / SUSPENDED / CLOSED` показать, что история доступна, но новые внешние заказы не поступают до снятия паузы.
- Критерий закрытия:
  - UI отражает внутреннюю доменную логику, а не только сырой marketplace status;
  - пользователь понимает причину отсутствия stock-effect;
  - фронтенд не создает ложных ожиданий по paused integrations.

**Что сделано**

Полностью переписана страница [Orders.tsx](apps/web/src/pages/Orders.tsx). Старая версия читала legacy `/sync/orders` (плоский `MarketplaceOrder` без internal status, items и timeline) и дополняла каждую строку прямыми axios-вызовами в WB/Ozon API через `/sync/order/:id/details` — что нарушало §10 ("прямой polling запрещён"). Новая страница работает только с доменным `/api/orders`-контуром из TASK_ORDERS_5.

### 1. Доменные типы во фронте

Зеркалят backend DTO ровно один-в-один: `OrderHeader`, `OrderItemDto`, `OrderEventDto` плюс enum-типы `Marketplace`, `FulfillmentMode`, `InternalStatus`, `StockEffectStatus`, `MatchStatus`, `OrderEventType`. Это даёт TS-проверку при любых изменениях бэкенда — переименование enum-значения сразу подсветится в UI.

### 2. Список заказов (`Orders.tsx`)

#### Фильтры (§6/§7 system-analytics)

Пять контролов в одну строку:
- **Маркетплейс** — `ALL / WB / OZON`.
- **Тип отгрузки** — `ALL / FBS / FBO`. Раньше эта ось была невидима в UI, хотя в данных она ключевая для understand'инга stock-effects.
- **Внутренний статус** — `IMPORTED / RESERVED / CANCELLED / FULFILLED / DISPLAY_ONLY_FBO / UNRESOLVED`. Все 6 вариантов из §13 представлены человекочитаемыми лейблами (`INTERNAL_STATUS_LABEL` константа). Это критическое требование TASK §22: "UI отражает внутреннюю доменную логику, а не только сырой marketplace status".
- **Эффект на остаток** — `NOT_REQUIRED / PENDING / APPLIED / BLOCKED / FAILED`. Для каждого значения есть лейбл + объяснение причины (`STOCK_EFFECT_LABEL.explain`), которые видны в drawer'е.
- **Поиск по номеру** — ILIKE по `marketplaceOrderId`, передаётся как `?search=`.

Фильтры дебаунсятся (200мс) и сбрасывают `page` к 1 при изменении.

#### KPI tiles по текущей странице

6 цветных карточек: «Резерв», «Выполнено», «Отменено», «Требует разбора», «Ошибка остатка», «FBO». Высчитываются из текущего `orders[]` (страница), без отдельного запроса — простой quick UX, без обещания глобальной сводки.

#### Таблица

Колонки: Дата (с relative `timeAgo`), Источник (WB/OZON badge), Номер (моно-шрифт), Тип (FBS/FBO), **Внутренний статус** (цветной chip из `INTERNAL_STATUS_LABEL`), Внешний статус (мелким серым шрифтом), **Эффект на остаток** (с иконкой + цветной текст), CTA «Подробнее →».

`Внутренний статус` и `Эффект на остаток` — два отдельных индикатора, потому что они **семантически разные**: заказ может быть `RESERVED` логически, но `stockEffectStatus=FAILED` (резерв ещё не применился). Старая версия показывала только marketplace status, и оператор не мог различить эти состояния.

### 3. Drawer заказа

Boczная панель (правая) с тремя секциями:

#### a. Header summary
Маркетплейс, тип отгрузки, внутренний статус (chip), внешний статус, время создания на маркетплейсе, время последнего обработанного события.

#### b. Stock effect block — главная диагностическая секция

Цветной блок (rose/orange/amber/emerald/slate в зависимости от `stockEffectStatus`) с:
- **Машинным статусом** (например, "Ошибка применения").
- **Объяснением** на русском: например для `FAILED` — "Side-effect не применился. Чаще всего из-за несопоставленного SKU или неопределённого склада. Используйте «Повторить обработку» после устранения причины." Это закрывает §22 требование "пользователь понимает причину".
- **Дополнительный warning для `UNRESOLVED`**: "В заказе есть несопоставленные SKU или не задан склад. Резерв не будет выполнен до устранения причины — пожалуйста, проверьте список товаров ниже." Прямой указатель на список товаров ниже.
- **Кнопка «Повторить обработку»** для FBS заказов в `RESERVED/CANCELLED/FULFILLED`. Дёргает `POST /orders/:id/reprocess`. Disabled при paused integration. Показывает `result.status` + `detail` после ответа (`APPLIED / STILL_FAILED / BLOCKED_BY_TENANT / NOT_APPLICABLE`).

#### c. Items list

Карточки товаров с:
- name + SKU + quantity + price (Decimal как строка из бэка).
- chip `MATCHED / UNMATCHED` (зелёный/красный).
- chip `Склад не определён` (амбер) — если `warehouseId === null`. Это прямая отсылка к §14 правилу "warehouse scope для FBS должен быть определён".

Пользователь сразу видит, какие именно строки блокируют резерв.

#### d. Timeline events

Вертикальная шкала (typical timeline UX) по `OrderEvent[]`. Для каждого события: иконка + лейбл (`EVENT_LABEL` константа) + время + JSON payload в `<pre>` (раскрытый, чтобы оператор мог увидеть `from/to`, `eventOccurredAt`, `reprocess: true` и т.п.). 9 типов событий из §15 покрыты:
`RECEIVED / STATUS_CHANGED / RESERVED / RESERVE_RELEASED / DEDUCTED / RETURN_LOGGED / DUPLICATE_IGNORED / OUT_OF_ORDER_IGNORED / STOCK_EFFECT_FAILED`.

Это даёт оператору полное audit-trail, который раньше существовал только в БД и был доступен через psql.

### 4. Paused integration banner

В шапке страницы — амбер баннер с иконкой `PauseCircle`, который показывается когда `activeTenant.accessState ∈ {TRIAL_EXPIRED, SUSPENDED, CLOSED}`:

> «Интеграции с маркетплейсами на паузе. История ваших заказов доступна для просмотра, но новые заказы из внешних API не будут приходить до снятия ограничения по компании (TRIAL_EXPIRED). Side-effects на остатки также не применяются.»

Закрывает §22 требование "фронтенд не создает ложных ожиданий по paused integrations". Дополнительно — кнопка «Повторить обработку» в drawer'е disabled при paused (с tooltip), backend всё равно вернёт `BLOCKED_BY_TENANT`, но UI заранее предупреждает.

### 5. Что удалено / упрощено относительно старой Orders.tsx

- ❌ **`POST /sync/orders/poll`** — кнопка ручного дёрганья polling'а ушла. Орdrs модуль не должен инициировать sync-операции (§10). Sync остаётся отдельной поверхностью (страница `/app/sync-runs`).
- ❌ **`GET /sync/order/:id/details`** — прямой proxy к WB/Ozon API из orders UI. Заменён на `GET /orders/:id` + timeline (никаких внешних HTTP-вызовов).
- ❌ **`translateStatus()` для raw external statuses** — UI теперь показывает internal status (бизнесовый), а raw external выводится мелким серым справа для тех, кому нужна сырая трасса.
- ❌ Колонка «Учтено / Не учтено» (статичная) — заменена на динамический `stockEffectStatus` с реальным состоянием.

### 6. Проверки

- `npx tsc --noEmit` (web) → 0 ошибок.
- Импорты только из `lucide-react`, `axios`, `react`, `../context/AuthContext` — никаких внешних API клиентов.

### 7. DoD сверка

- ✅ **UI отражает внутреннюю доменную логику**: `internalStatus` + `stockEffectStatus` индикаторы заменили raw `status` колонку. В drawer'е оператор видит timeline своих 9 типов внутренних событий.
- ✅ **Пользователь понимает причину отсутствия stock-effect**: цветной блок объяснения + warning для UNRESOLVED + chip "Не сопоставлен" / "Склад не определён" на конкретных items.
- ✅ **Не создаёт ложных ожиданий по paused integrations**: paused banner в шапке + reprocess disabled + сообщение о том, что новые заказы не придут.

### 8. Что НЕ сделано (за пределами scope §11)

- **Вспомогательная страница для resolve UNRESOLVED items** — UI для ручного маппинга SKU → Product и выбора склада. Это требует отдельной задачи на стыке `05-catalog` и `07-warehouses` (mappings UI). Сейчас оператор может только увидеть проблему, но не resolve её прямо со страницы заказов.
- **Live-режим** — авто-poll каждые N секунд. Решено пока не делать (избегаем визуальных дёрганий и нагрузки на API; ручной «Обновить список» закрывает 90% сценариев).
