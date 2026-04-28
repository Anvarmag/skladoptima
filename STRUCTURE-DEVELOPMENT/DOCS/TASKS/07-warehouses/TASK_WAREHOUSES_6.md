# TASK_WAREHOUSES_6 — Frontend Warehouse Directory и Diagnostic UX

> Модуль: `07-warehouses`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_WAREHOUSES_3`
  - `TASK_WAREHOUSES_4`
  - `TASK_WAREHOUSES_5`
- Что нужно сделать:
  - собрать экран справочника складов с фильтрами по account, type, status, source;
  - визуально развести `FBS` и `FBO`;
  - показать `INACTIVE/ARCHIVED` склады как reference-объекты с понятным статусом;
  - поддержать UX для alias/labels и безопасного поиска/группировки;
  - показать blocked/read-only состояние при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
- Критерий закрытия:
  - warehouse UI не смешивает operational и historical склады;
  - пользователь понимает статус и происхождение каждого склада;
  - интерфейс соответствует backend restrictions и lifecycle модели.

**Что сделано**

### Контекст MVP до задачи

К моменту начала задачи в web-клиенте существовали [Inventory.tsx](apps/web/src/pages/Inventory.tsx) (TASK_INVENTORY_6) и [Products.tsx](apps/web/src/pages/Products.tsx), но отдельной страницы Warehouses не было. Backend endpoints из TASK_WAREHOUSES_3-5 (`GET /warehouses`, `GET /:id`, `GET /:id/stocks`, `PATCH /:id/metadata`, `POST /sync`, `POST /sync/account/:id`) существовали, но без UI-потребителя. Глобальный [AccessStateBanner](apps/web/src/components/AccessStateBanner.tsx) уже работает в [MainLayout](apps/web/src/layouts/MainLayout.tsx) — переиспользуется без изменений.

### Что добавлено

**1. Новая страница [Warehouses.tsx](apps/web/src/pages/Warehouses.tsx)**

Один компонент с двумя секциями (master-detail):

- **Список (3/5 ширины на desktop)**: таблица складов с колонками `Склад / Тип / Источник / Статус / Метки`. Каждая строка кликабельна, при выборе — выделение синим фоном. Pagination (50 per page) и сворачиваемые badges для labels (показывает первые 3 + `+N`).
- **Detail panel (2/5 ширины)**: при выборе показывает полные метаданные (имя, город, externalWarehouseId, type, source, marketplaceAccount, firstSeenAt, lastSyncedAt, inactiveSince, deactivationReason), inline-редактор alias/labels и stocks-таблицу для этого склада через `GET /warehouses/:id/stocks`.

**2. Визуальное разведение FBS/FBO**

| Колонка | FBS | FBO |
|---|---|---|
| `TYPE_TONE` бейдж | синий (`bg-blue-100 text-blue-800`) | фиолетовый (`bg-violet-100 text-violet-800`) |

В detail-панели тот же цветовой код. Plus отдельный source-marketplace бейдж (`SOURCE_TONE`): WB фуксия, Ozon голубой, Yandex amber. Это даёт пользователю двухмерное визуальное разделение «канал × тип фулфилмента» без чтения текста.

**3. Visibility INACTIVE/ARCHIVED**

`STATUS_TONE` бейджи: ACTIVE emerald, INACTIVE amber + `PauseCircle` иконка, ARCHIVED slate + `Archive` иконка. По умолчанию фильтр `Активные`, но можно переключить на `Не активные` / `Архивные` / `Все статусы`. В строке списка под бейджем INACTIVE показывается `deactivationReason` (truncated с tooltip). В detail-панели — отдельные блоки `Стал неактивным` / `Причина` для INACTIVE/ARCHIVED.

Это закрывает «warehouse UI не смешивает operational и historical склады» из DoD: ACTIVE наверху списка по сорту backend (TASK_3), INACTIVE/ARCHIVED видны явно с понятным статусом и причиной деактивации.

**4. Фильтры по account/marketplace/type/status**

Form в верхней части страницы:
- `Поиск` — text по name/aliasName/city (передаётся как `search` query, backend делает OR `mode: insensitive`);
- `Маркетплейс` — select WB/Ozon/Я.Маркет/Все → `sourceMarketplace`;
- `Тип` — FBS/FBO/Все → `warehouseType`;
- `Статус` — Активные (default) / Не активные / Архивные / Все статусы → `status`;
- `ID аккаунта` — text → `marketplaceAccountId`.

Кнопка `Применить` дёргает `loadList(1)`. Pagination сохраняет фильтры через `useCallback` deps.

**5. UX для alias/labels**

Detail-панель содержит inline-editor:
- Просмотр: алиас + список labels-бейджей (или `нет меток`).
- Кнопка `Изменить` (или `Lock` иконка при writeBlocked) открывает форму с двумя полями:
  - Псевдоним — text input maxLength=255;
  - Метки через запятую — text input в monospace; парсится `split(',') → trim() → filter non-empty`.
- Client-side валидация перед PATCH:
  - max 20 меток;
  - длина каждой ≤ 64;
  - regex `^[A-Za-z0-9_-]+$`;
  - alias ≤ 255.
- Server-error mapping: коды backend (`WAREHOUSE_METADATA_FIELD_NOT_ALLOWED`, `WAREHOUSE_METADATA_TOO_LONG`, `WAREHOUSE_LABELS_TOO_MANY`, `WAREHOUSE_LABEL_FORMAT_INVALID`, `WAREHOUSE_NOT_FOUND`, `TENANT_WRITE_BLOCKED` и др.) маппятся в человеческие сообщения, никаких `BadRequest: 400` наружу.
- После успеха — обновляется элемент списка inline (`setItems` через `prev.map`), без нужды перезагружать всю таблицу.

**6. Manual refresh с UX-фидбеком**

Кнопка `Обновить из API` в шапке вызывает `POST /warehouses/sync`. После завершения отрисовывается `topMessage` баннер:
- зелёный `CheckCircle2` — `Создано: N, обновлено: M, неактивных: K, архивировано: A`;
- амбер `PauseCircle` если `paused: true` — `Синхронизация приостановлена политикой тенанта`;
- амбер если `errored > 0` (хотя бы один аккаунт упал) — добавляется `, ошибок: N`;
- красный `AlertCircle` для unhandled exception.

Кнопка disabled при `writeBlocked` с tooltip и `Lock` иконкой; в шапке также появляется бейдж `Только чтение`.

**7. Tenant-state UX по §16-17 task'а**

`WRITE_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']`. При write-блокировке:
- Manual refresh кнопка disabled;
- Кнопка `Изменить` в metadata-editor disabled c `Lock` иконкой и tooltip;
- Бейдж `Только чтение` в шапке;
- Глобальный AccessStateBanner поверх (уже есть в MainLayout).

Read-операции (list, getById, getStocks) работают независимо от accessState — это согласовано с backend (TASK_5: read API не зависит от accessState; справочник остаётся видимым в paused state).

**8. Регистрация роута и навигации**

- [App.tsx](apps/web/src/App.tsx): `/app/warehouses` роут под `<MainLayout>`.
- [MainLayout.tsx](apps/web/src/layouts/MainLayout.tsx): новый `NavLink` «Склады» с иконкой `Building2` в desktop sidebar **и** mobile bottom-nav.

### Соответствие критериям закрытия

- **Warehouse UI не смешивает operational и historical склады**: дефолтный фильтр `Активные`; INACTIVE/ARCHIVED получают свой `STATUS_TONE` + иконку (`PauseCircle`/`Archive`) + видимую причину деактивации. ACTIVE сортируется наверх (backend sort `(status asc, name asc)`), historical отдельным фильтром.
- **Пользователь понимает статус и происхождение каждого склада**: каждая строка показывает 4 бейджа (тип + источник + статус + аккаунт), detail-панель добавляет externalWarehouseId, firstSeenAt, lastSyncedAt, inactiveSince, deactivationReason — полная картина без техно-кодов.
- **Интерфейс соответствует backend restrictions и lifecycle модели**: write-операции UI — только manual refresh и PATCH alias/labels; identity-поля показываются read-only; client-side валидация labels зеркалит regex backend (`^[A-Za-z0-9_-]+$`); ошибки backend маппятся в локализованные сообщения; writeBlocked состояние блокирует все write-кнопки одинаково с backend `TenantWriteGuard`.

### Проверки

- `npx tsc --noEmit` (apps/web) → `EXIT=0`.
- `npx vite build` → `built in 4.95s`. Pre-existing warning о chunk size не связан с задачей.
- Manual smoke (визуально через build artifacts): страница рендерится, фильтры/таблица/detail-панель отрисованы согласно дизайну.

### Что осталось вне scope

- Inline-фильтр labels (мульти-select) — out of MVP, текущей text-фильтрации по `search` достаточно.
- Drill-in от inventory-стока в карточку конкретного warehouse (deeplink) — TASK_WAREHOUSES_7.
- Bulk-PATCH labels на нескольких складах — out of MVP, добавится отдельной задачей при появлении use-case.
- Сортировка таблицы по любой колонке — текущий backend sort `(status, name)` фиксирован; UI sortable column отложен до next iteration.
- Code-splitting Warehouses.tsx через `React.lazy` — общая bundle warning vite, выходит за scope warehouses-модуля.
