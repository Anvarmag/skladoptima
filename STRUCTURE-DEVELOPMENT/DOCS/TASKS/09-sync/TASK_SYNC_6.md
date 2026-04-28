# TASK_SYNC_6 — Frontend History, Run Details и Conflict UX

> Модуль: `09-sync`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_SYNC_2`
  - `TASK_SYNC_3`
  - `TASK_SYNC_4`
  - `TASK_SYNC_5`
- Что нужно сделать:
  - собрать экран истории run и страницу деталей конкретного запуска;
  - показать summary по этапам, blocked reasons, error codes и conflict list;
  - заблокировать кнопки `sync now`, `retry`, `full sync` при `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - явно различать `failed` и `blocked by policy` на уровне UX текста и статусов;
  - не выводить в UI `tenant full sync` как MVP-функцию.
- Критерий закрытия:
  - пользователь понимает, что синхронизация сделала и почему она не пошла дальше;
  - UI не предлагает запрещенные действия;
  - diagnostics flow пригоден для owner/admin/manager в рамках их прав.

**Что сделано**

### Контекст MVP до задачи

В [apps/web/src/pages/](apps/web/src/) на момент TASK_SYNC_6:
- Раздел [History.tsx](apps/web/src/pages/History.tsx) — это **AuditLog** (история изменений товаров: stock adjustments, manual edits, order deductions). Sync-аналог отсутствовал.
- [MarketplaceAccounts.tsx](apps/web/src/pages/MarketplaceAccounts.tsx) показывает `lastSyncResult / lastSyncErrorCode / lastSyncErrorMessage` из `MarketplaceAccount` (TASK_MARKETPLACE_ACCOUNTS_*) — это **per-account snapshot**, не история запусков.
- Нет ни одного UI-элемента для backend endpoints `GET /sync/runs`, `GET /sync/runs/:id`, `POST /sync/runs`, `POST /sync/runs/:id/retry`, `GET /sync/conflicts`, `POST /sync/conflicts/:id/resolve`, которые появились в TASK_SYNC_2 и TASK_SYNC_4.
- Кнопок «Sync now» / «Retry» нет вообще; backend endpoints были, но никакого триггера у пользователя.
- Конфликты невозможно увидеть и закрыть.
- AccessState уже передаётся в `useAuth().activeTenant.accessState` ([AuthContext.tsx](apps/web/src/context/AuthContext.tsx)), баннер тарифного состояния `AccessStateBanner` выводится в `MainLayout`. То есть инфраструктура для блокировки кнопок при `TRIAL_EXPIRED/SUSPENDED/CLOSED` уже есть — нужно её правильно использовать.

### Что добавлено

**1. Новая страница [SyncRuns.tsx](apps/web/src/pages/SyncRuns.tsx)**

~640 строк. Состоит из:

| Уровень | Компонент |
|---|---|
| Top-level | `SyncRuns` — список + детали + конфликты с переключением через два таба (`runs`/`conflicts`) и роутинг через `selectedId` state |
| List view | `RunListItem`, `StatusBadge` |
| Detail view | `RunDetailView` (summary + blocked/failed/partial banners + items + conflicts) |
| Conflicts | `ConflictsTabView` (фильтр open/resolved/all + resolve кнопка) |
| Actions | `CreateRunModal` (manual sync now) |

Маршрут добавлен в [App.tsx](apps/web/src/App.tsx): `/app/sync` под `<MainLayout>` (то есть требует auth + active tenant).

В [MainLayout.tsx](apps/web/src/layouts/MainLayout.tsx) добавлен пункт навигации «Синхронизация» с иконкой `RefreshCw` сразу после «Подключения».

**2. UX-критичный словарь — почему что не работает**

Словари `BLOCKED_REASON_TEXT` и `ERROR_CODE_TEXT` мапят машинные коды backend'а (TASK_SYNC_3 + TASK_SYNC_4 + TASK_SYNC_5) в человеческий текст с **подсказкой действия**. Каждая запись имеет `title` (что произошло) и `hint` (что делать):

| Код (backend) | Title (UI) | Hint |
|---|---|---|
| `TENANT_TRIAL_EXPIRED` | Пробный период истёк | Оформите подписку — синхронизация возобновится автоматически. |
| `TENANT_SUSPENDED` | Доступ приостановлен | Обратитесь в службу поддержки. |
| `TENANT_CLOSED` | Компания закрыта | Доступ к синхронизации недоступен. |
| `ACCOUNT_INACTIVE` | Подключение отключено | Активируйте подключение в разделе «Подключения». |
| `CREDENTIALS_INVALID` | Ключи недействительны | Обновите API-ключи в разделе «Подключения». |
| `CREDENTIALS_NEEDS_RECONNECT` | Требуется переподключение | Перевыпустите токен у маркетплейса и обновите его в подключении. |
| `CONCURRENCY_GUARD` | Уже выполняется другой sync | Дождитесь завершения текущего запуска и попробуйте снова. |
| `EXTERNAL_RATE_LIMIT` | (error) | Маркетплейс ограничил частоту запросов. Повтор будет автоматически. |
| `EXTERNAL_AUTH_FAILED` | (error) | Маркетплейс отклонил ключи (401/403). Обновите API-ключи. |
| `EXTERNAL_TIMEOUT` | (error) | Таймаут запроса к маркетплейсу. Повтор будет автоматически. |
| `EXTERNAL_5XX` | (error) | Сервер маркетплейса временно недоступен (5xx). Повтор будет автоматически. |

UX-правило, реализованное в `RunDetailView`: блок «Что произошло» **разный** для статусов `BLOCKED` и `FAILED` (фиолетовый и красный фон, иконки `PauseCircle` vs `XCircle`, заголовок «Что произошло» vs «Запуск завершился с ошибкой»). Это закрывает §10/§20 system-analytics — _«если blocked runs смешать с failed runs, support и пользователь не смогут отделить интеграционные инциденты от продуктовых policy-ограничений»_. Машинный код тоже показывается мелким шрифтом — для support/копирования в тикет.

Для retryable failures (`EXTERNAL_TIMEOUT/RATE_LIMIT/5XX`) дополнительно показывается `nextAttemptAt` — пользователь видит, что повтор будет автоматически и когда ожидать.

**3. Блокировка кнопок при paused tenant state**

Использует существующий список `EXTERNAL_API_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']` (тот же, что в [MarketplaceAccounts.tsx:13](apps/web/src/pages/MarketplaceAccounts.tsx) — единая семантика).

Заблокированы:
- Кнопка «Запустить sync» в верхней панели — `disabled` + иконка `Lock` + tooltip «Запуск синхронизации недоступен в текущем тарифном статусе»;
- Кнопка «Повторить» в `RunDetailView` — то же самое;
- Доступ к manual sync через `CreateRunModal` — модалка не открывается (кнопка disabled).

Что **НЕ** заблокировано (намеренно):
- Чтение списка / деталей / конфликтов — §10 system-analytics: _«история и диагностика прошлых runs остаются доступными в read-only режиме»_;
- Resolve конфликта — это **внутренний audit/cleanup**, не внешний API call. Соответствует backend-решению TASK_SYNC_4 (resolve не под `TenantWriteGuard`).

Это даёт критерий «UI не предлагает запрещенные действия»: кнопки видны, но visually disabled с явной подсказкой почему. Не показывать вообще было бы хуже — пользователь не понял бы, почему функциональность пропала.

**4. Tenant full sync намеренно НЕ выведен**

В `CreateRunModal` доступны только 4 типа: `PULL_STOCKS`, `PULL_ORDERS`, `PULL_METADATA`, `PUSH_STOCKS`. `FULL_SYNC` отсутствует в списке выбора. Это §10/§13/§17 system-analytics: _«tenant full sync выносится в future scope»_ — backend поддерживает, runtime surface для пользователя нет.

Дополнительно DTO backend (TASK_SYNC_2 [create-sync-run.dto.ts](apps/api/src/modules/sync-runs/dto/create-sync-run.dto.ts)) валидирует `syncTypes[]` через `IsIn(Object.values(SyncTypes))`, и service всегда подставляет `triggerScope: ACCOUNT`. Defense-in-depth: UI не показывает, DTO не примет, service не создаст.

**5. Role-based access**

Использует `activeTenant.role` (доступен через `useAuth()`):
- `OWNER`/`ADMIN` могут запускать sync now и retry (`canTriggerSync = role === 'OWNER' || role === 'ADMIN'`);
- `MANAGER` может закрывать конфликты и просматривать всё;
- `STAFF` уровня нет в этом разделе вообще (`MainLayout` не фильтрует, но кнопки скрыты).

Это соответствует §3 system-analytics:

| Актор | Что делает |
|---|---|
| Owner/Admin | Запускает manual sync, смотрит статус |
| Manager | Просматривает историю и диагностику. Без запуска ручных sync/retry |

**6. List view UX**

`RunListItem` показывает в одной строке:
- цветной `StatusBadge` с иконкой (Loader2 анимирован для IN_PROGRESS, PauseCircle для BLOCKED — отделяет visually от XCircle FAILED);
- название подключения + trigger type + номер попытки;
- список sync types в человекочитаемом виде (`Получение остатков, Получение заказов`);
- inline-причина блокировки/ошибки/partial с цветным акцентом (фиолетовый/красный/янтарный);
- timestamp создания + длительность (`2 мин 13 с`).

Фильтры: статус, подключение. Pagination через `meta.lastPage`.

**7. Detail view UX**

`RunDetailView` собирает в одном экране:
- **Header** со статус-бейджем, тип триггера, номер попытки, retry кнопка (если eligible: FAILED/PARTIAL_SUCCESS + attemptNumber < maxAttempts);
- **Status banner** — разный для BLOCKED / FAILED / PARTIAL_SUCCESS (см. выше про UX-словарь);
- **Summary cards** (4 шт): создан, длительность, обработано, ошибок (выделено янтарным если > 0);
- **Origin link** — если этот run — повтор, ссылка на оригинал;
- **Items list** — только проблемные (FAILED/CONFLICT/BLOCKED) с stage, type, item key, JSON error;
- **Conflicts list** с conflictType, entityType:entityId, статусом resolved.

Когда run = SUCCESS и items[]/conflicts[] пусты — вместо «история пуста» показываем явный optimistic message _«Все элементы обработаны успешно. Подробной построчной истории нет — это нормально для штатного запуска»_. Это закрывает MVP-правило §8 — пользователь видит, что не всё сломалось, просто `success path хранится агрегатами` (TASK_SYNC_4 invariant).

**8. Conflicts tab**

Отдельный таб с фильтром (open / resolved / all). По каждому конфликту:
- conflictType + entityType:entityId;
- ссылка на породивший run (`onClick` → `openDetail(conflict.runId)`);
- кнопка «Закрыть» (только для open + если есть права).

Resolve работает через `POST /sync/conflicts/:id/resolve` — backend идемпотентен (TASK_SYNC_4), поэтому двойной клик не ломается.

**9. Top-level message bar**

Универсальный banner для feedback (`ok` / `warn` / `err`) — показывает результат действий с кнопкой закрытия. Особый случай: при создании run с blocked-статусом (например, попытка ручного sync на `INVALID` credentials) banner показывает `warn` с человеческим reason, а не `ok`. Запуск сохраняется в истории, пользователь сразу видит результат.

### Соответствие критериям закрытия

- **Пользователь понимает, что синхронизация сделала и почему она не пошла дальше**: каждый блок ошибки/блокировки имеет title + hint + машинный код. Detail view показывает stage/items/conflicts с JSON error для diagnostics.
- **UI не предлагает запрещенные действия**: кнопки `sync now` и `retry` блокируются при `TRIAL_EXPIRED/SUSPENDED/CLOSED` через `disabled + tooltip`. Tenant full sync вообще отсутствует в UI. Resolve конфликта работает в paused state (внутреннее audit действие).
- **Diagnostics flow пригоден для owner/admin/manager в рамках их прав**: триггер sync — только OWNER/ADMIN, чтение/конфликты — все три роли. Layout сохраняет existing pattern (`MainLayout` + `AccessStateBanner` уже работают).

### Проверки

- `npx tsc --noEmit` (web) → новых ошибок нет.
- `npx vite build` (web) → ✓ built in 4.74s; chunk 948 kB / gzip 268 kB. Pre-existing warning про `OnboardingState` re-export не связан с задачей.
- `npx jest src/modules/sync-runs/ src/modules/marketplace-accounts/` (api) → **Tests: 198 passed, 198 total** (9 suites). Backend регрессия чистая — задача чисто frontend, backend не трогался.

### Что НЕ делается (намеренно)

- **WebSocket / live progress** для IN_PROGRESS run — нет, polling через «Обновить» кнопку. Реалтайм не критичен для MVP, и dispatcher (TASK 18-worker) ещё не работает в production — runs в основном пройдут от QUEUED → SUCCESS быстрее, чем пользователь успеет открыть detail view.
- **i18n** строк — пока всё на русском (как и весь интерфейс приложения). Когда появится i18n инфраструктура, словари `BLOCKED_REASON_TEXT`/`ERROR_CODE_TEXT` переедут в i18n keys.
- **Telegram Mini App-специфичная адаптация** (BackButton hooks для detail view) — стандартный pattern из `MainLayout` уже работает: `Telegram.BackButton` показан на любой подстранице, нажатие = `navigate(-1)`. Detail view это обрабатывает через `setSelectedId(null)` через `<button onClick>` или browser back.
- **Метрики посещения раздела / heatmap кнопок** — TASK_SYNC_7 (observability runbook).
- **Auto-refresh списка через interval** — пока ручное обновление, чтобы не нагружать backend полингом без нужды.

### Что осталось вне scope

- Production WB/Ozon adapter runners + queue dispatcher для перевода `QUEUED → IN_PROGRESS → SUCCESS/...` — отдельный rollout (после TASK_SYNC_5 контракта engine'а).
- Интеграционные тесты + Playwright E2E + observability runbook — TASK_SYNC_7.
- Notifications (toast / push / email) при FAILED run — отдельная задача в `notifications` модуле.
