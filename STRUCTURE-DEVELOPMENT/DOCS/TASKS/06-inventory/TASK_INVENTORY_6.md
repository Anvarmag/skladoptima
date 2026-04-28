# TASK_INVENTORY_6 — Frontend Inventory UX и Diagnostics

> Модуль: `06-inventory`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_INVENTORY_2`
  - `TASK_INVENTORY_5`
- Что нужно сделать:
  - собрать экраны balances, movements, low-stock и manual adjustments;
  - показать пользователю `on_hand`, `reserved`, `available` и причину изменений;
  - отрисовать read-only state в `TRIAL_EXPIRED` и blocked state в `SUSPENDED/CLOSED`;
  - учесть warehouse scope, low-stock thresholds и movement history filters;
  - дать diagnostic UX для conflicts, blocked writes и repeated effect cases.
- Критерий закрытия:
  - inventory UI не скрывает бизнес-смысл изменений;
  - blocked/write-disabled состояния понятны пользователю;
  - screens согласованы с backend policy и movement model.

**Что сделано**

### Контекст MVP до задачи

В web-клиенте отдельной inventory-страницы не существовало. На стороне фронта работали:
- [Products.tsx](apps/web/src/pages/Products.tsx) — каталоговый экран с `total/reserved/available` и каналными счётчиками `wbFbs/wbFbo/ozonFbs/ozonFbo` прямо в таблице товаров; manual stock adjust был встроен туда же без warehouse scope, без movements и без обязательного reasonCode;
- [AccessStateBanner](apps/web/src/components/AccessStateBanner.tsx) уже работал в [MainLayout](apps/web/src/layouts/MainLayout.tsx) и показывал баннер для TRIAL_EXPIRED/SUSPENDED/CLOSED — этот компонент переиспользую без изменений;
- API-эндпоинты из TASK_INVENTORY_2-5 (`/inventory/stocks`, `/inventory/movements`, `/inventory/low-stock`, `/inventory/adjustments`, `/inventory/settings`, `/inventory/diagnostics`, `/inventory/conflicts`, `/inventory/effect-locks`) существовали, но без UI-потребителя.

История движений, low-stock alerts, manual adjustment с обязательным reason, diagnostics conflicts/blocked-writes на фронте отсутствовали.

### Что добавлено

**1. Новая страница [Inventory.tsx](apps/web/src/pages/Inventory.tsx)**

Один экран с четырьмя вкладками (`useState` tab) — компактный и без лишних роутов:

- **Остатки (`balances`)** — таблица товаров с `on_hand/reserved/available`, разбивкой по складам через цветные бейджи (`FBS/FBO`, `available`, FBO явно помечен), поиск по SKU/названию, пагинация. Кнопка «Корректировка» открывает диалог.
- **История движений (`movements`)** — таблица 50 последних движений с фильтрами `productId` и `movementType`. Колонки: дата, тип (цветной бейдж по `MOVEMENT_TONE`), товар, Δ (зелёный/красный по знаку), `on_hand до → после`, `reserved до → после`, причина+комментарий, источник + actor.email + sourceEventId.
- **Низкий остаток (`lowStock`)** — карточка inline-редактирования порога (PATCH `/inventory/settings/threshold`) и таблица low-stock items с колонкой `source: balance | product_fallback` (отражает lazy-bridge с MVP).
- **Диагностика (`diagnostics`)** — 8 счётчик-карточек (locks PROCESSING/APPLIED/IGNORED/FAILED, conflicts 24h, reserve/release fail 24h, deduct fail 24h, окно), таблица CONFLICT_DETECTED движений, таблица FAILED effect locks. Карточки помечают `warn=true` при ненулевых значениях — оператор сразу видит что требует внимания.

**2. Manual adjustment dialog**

Модалка показывает:
- snapshot текущего товара (`on_hand/reserved/available`);
- toggle между режимами `delta` и `targetQuantity` (соответствует backend DTO);
- select причины с подсказками (`RECOUNT/LOSS/FOUND/DAMAGE/RETURN_RESTOCK/OTHER`) — все в UPPER_SNAKE_CASE как требует backend regex;
- comment textarea;
- inline-валидация (нулевая дельта, отрицательный target);
- маппинг кодов ошибок с backend в человеческие сообщения: `NEGATIVE_STOCK_NOT_ALLOWED`, `RESERVED_EXCEEDS_ONHAND`, `ADJUSTMENT_NOOP`, `INVENTORY_WRITE_BLOCKED_BY_TENANT_STATE` и т.д.

После успеха — refresh `loadStocks(stocksPage, search)` без потери контекста пагинации.

**3. Read-only / blocked UX**

Константа `WRITE_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']` определяет режим. При `writeBlocked === true`:
- кнопка «Корректировка» становится disabled, иконка меняется на `Lock`, в `title` показывается `ucWriteBlockedHint(state)` с человеческим объяснением;
- кнопка сохранить порог тоже disabled с tooltip;
- в шапке страницы появляется бейдж `Lock + «Режим только для чтения»` — сразу заметно, не нужно скроллить;
- `AccessStateBanner` поверх (из MainLayout) даёт глобальный CTA (оформить подписку / связаться с поддержкой).

При попытке write API всё равно вернёт 403 с `INVENTORY_WRITE_BLOCKED_BY_TENANT_STATE` или `TENANT_WRITE_BLOCKED` — клиент маппит оба кода в один и тот же hint, чтобы UX не путал пользователя двумя сообщениями про одно и то же.

**4. Diagnostic UX для conflicts / repeated effect / failed locks**

- `CONFLICT_DETECTED` movements в основной истории помечаются красным бейджем (через `MOVEMENT_TONE`) и одновременно дублируются в выделенной таблице на вкладке Диагностика.
- `FAILED effect locks` показываются с цветным `LOCK_TONE` бейджем (PROCESSING blue / APPLIED emerald / IGNORED slate / FAILED red), у каждой строки виден `effectType`, `sourceEventId` (truncate + title для tooltip), момент `updatedAt`.
- Счётчики выделены `warn=true` (красная окантовка карточки) если `failed > 0`, `conflicts > 0`, `reserve/release fail > 0`, `deduct fail > 0`, либо `processing > 5` (намёк на застрявший lock). Это базовый visual-alerting без лишней инфраструктуры.

**5. Регистрация в App / Layout**

- [App.tsx](apps/web/src/App.tsx): новый роут `/app/inventory` под `<MainLayout>` и `PrivateRoute`.
- [MainLayout.tsx](apps/web/src/layouts/MainLayout.tsx): новый `NavLink` «Учёт остатков» (icon `Boxes`) в desktop sidebar и в мобильном bottom-nav. Старый `/app` index переименован с «Остатки» на «Каталог», чтобы устранить смысловое пересечение с новой страницей.

**6. Tooling / regressions**

- `npx tsc --noEmit` (apps/web) — `EXIT=0`, новых ошибок типизации нет.
- `npx vite build` — `built in 5.79s`, новый Inventory входит в основной chunk. Остальные warnings (`OnboardingState/OnboardingStep` re-export, размер chunk) pre-existing и не связаны с задачей.

### Соответствие критериям закрытия

- **Inventory UI не скрывает бизнес-смысл изменений**: каждое движение показывает `Δ`, before/after для `onHand` и `reserved`, обязательную `reasonCode`, `comment`, `actorUser.email`, `sourceEventId`. Adjustment dialog требует обязательную причину перед submit. CONFLICT_DETECTED не маскируется в общую категорию — отдельная diagnostics-карточка с `Δ = external − local`.
- **Blocked / write-disabled состояния понятны пользователю**: `AccessStateBanner` сверху + бейдж в шапке inventory-экрана + disabled-кнопки с tooltip + маппинг backend-кодов 403 в локализованные сообщения. Никаких «Forbidden» и «BadRequest» наружу.
- **Screens согласованы с backend policy и movement model**: типы `MovementType`, `EffectType`, `LockStatus`, `FulfillmentMode`, `LowStockItem.source`, поле `pushAllowed`/`pausedByTenantState` (через `accessState` из AuthContext) — точное отражение backend контрактов из TASK_INVENTORY_2-5. Reasoncode regex `^[A-Z0-9_]+$` зеркалит DTO-валидацию.

### Что осталось вне scope

- Drill-in от карточки товара в каталоге → конкретный balance/movements этого SKU (deeplink-навигация) — TASK_INVENTORY_7.
- Push-уведомления / email на rate-of-conflicts > threshold — TASK_INVENTORY_7 (observability rollup).
- Code-splitting Inventory.tsx через `React.lazy` — общая warning vite build, выходит за scope inventory модуля.
- Удаление каналных счётчиков `wbFbs/wbFbo/ozonFbs/ozonFbo` из карточки товара в Products.tsx (после полного перехода на StockBalance/effective-available API на стороне sync — отдельный sync-рефакторинг).
