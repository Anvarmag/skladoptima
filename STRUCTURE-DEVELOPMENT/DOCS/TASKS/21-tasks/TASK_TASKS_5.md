# TASK_TASKS_5 — Frontend Inbox, Kanban и quick-create UX

> Модуль: `21-tasks`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `12h`
- Зависимости:
  - `TASK_TASKS_3`
  - `TASK_TASKS_4`
- Что нужно сделать:
  - создать `apps/web/src/pages/Tasks.tsx` с двумя view-режимами:
    - **Inbox** (default): таблица «Мои открытые / Мне назначено сегодня / Я создал / Просрочено / Все открытые». Tabs сверху + counter badge у каждого таба.
    - **Kanban**: 3 колонки (`OPEN / IN_PROGRESS / WAITING`) + узкие колонки `DONE` (последние 7 дней) и `ARCHIVED` (свёрнутая). DnD для смены статуса.
  - **Quick-create modal** + горячая клавиша `Ctrl+I` (mac: `Cmd+I`):
    - один обязательный `title`, остальное опционально;
    - после Enter создаётся задача `assignee=me`, modal закрывается, появляется toast «Задача создана» с кнопкой «Открыть»;
    - расширенный режим разворачивает форму (assignee, due, category, priority, tags, related order/product).
  - **TaskDetailDrawer** (правая панель, как `OrderDetailDrawer`):
    - header с inline edit'ом title;
    - secondary: status / priority / assignee / due / category / tags — все inline editable;
    - secondary: related order/product link (открывает drawer заказа);
    - **Comments thread** (markdown render, с автoexpand на новые), поле ввода с `Cmd+Enter` для отправки;
    - **Timeline** TaskEvent (свёрнутая по умолчанию, expand для аудита).
  - **Связка из Orders**:
    - в `OrderDetailDrawer` (apps/web/src/pages/Orders.tsx) добавить кнопку «Создать задачу по заказу» → открывает quick-create modal с предзаполненным `title = "Заказ <marketplaceOrderId> — "` и `relatedOrderId`;
    - в drawer'е заказа отдельный блок «Связанные задачи» — список открытых задач с этим relatedOrderId.
  - **Paused-state**: write-кнопки disabled с tooltip'ом «Создание/редактирование недоступно при паузе интеграций» (как в `Orders.tsx`).
  - роут зарегистрировать в `App.tsx` (`/app/tasks`) и пункт меню в основной навигации.
- Критерий закрытия:
  - quick-create реально занимает 5 секунд: hotkey → 1 поле → Enter;
  - drawer заказа показывает связанные задачи и позволяет их создавать;
  - все mutations через единый API-клиент `axios` без axios-вызовов в маркетплейсы;
  - paused tenant получает понятный disabled-state без 500-ошибок.

**Что сделано**

Реализован полный фронтенд модуля задач. Создан `apps/web/src/pages/Tasks.tsx` (~750 строк) с двумя view-режимами.

**Inbox-вью:**
- Пять табов с counter-badge: «Мои открытые» (`assignee=me&status=OPEN,IN_PROGRESS,WAITING`), «Назначено сегодня» (серверный запрос + client-side фильтр по `createdAt >= today 00:00`), «Я создал» (`createdBy=me`), «Просрочено» (`overdue=true&assignee=me`), «Все открытые`. Счётчики загружаются параллельно 5 запросами с `limit=1` на маунте.
- Таблица: Priority (цветная точка), Title (с тегами), Status-badge, Assignee-email, Deadline (красный при просрочке), «Создана X назад». Пагинация Назад/Вперёд.

**Kanban-вью:**
- 3 основные колонки (OPEN / IN_PROGRESS / WAITING) с HTML5 drag-and-drop: `draggable` + `onDragStart/onDragOver/onDrop` → `POST /tasks/:id/status`. Оптимистично обновляет board через `onStatusChanged` (reload).
- Узкая колонка DONE (последние 7 дней, фильтр по `completedAt`), коллапсируемая кнопкой.
- Колонка ARCHIVED в виде свёрнутой вертикальной полоски.

**Quick-create modal:**
- Открывается кнопкой «Новая задача» или горячей клавишей `Ctrl+I` (mac: `Cmd+I`) — глобальный `keydown` listener на странице `/app/tasks`.
- Базовый режим: одно поле `title`, Enter → `POST /tasks` с `assigneeUserId = currentUser.id`. Modal закрывается, появляется toast «Задача создана» с кнопкой «Открыть».
- Расширенный режим (кнопка «Расширенная форма»): assignee picker из `/team/members`, datetime-local дедлайн, категория, приоритет, теги (через запятую), `relatedOrderId`.

**TaskDetailDrawer (правая панель):**
- Header: click-to-edit inline title (blur → `PATCH /tasks/:id`, Escape отменяет).
- Статус: ряд кнопок `OPEN / IN_PROGRESS / WAITING / DONE` → `POST /tasks/:id/status`.
- Priority/Assignee/Deadline/Category: `select`/`datetime-local` с `onChange`/`onBlur` → patch.
- Теги: отображение badge-list.
- Related order ID: отображение с иконкой ExternalLink.
- Описание: `whitespace-pre-wrap` блок.
- Комментарии: список с автором (email из members map), timestamp, кнопка удаления (только своих, `DELETE /tasks/:id/comments/:commentId`); поле ввода + `Send`-кнопка, `Ctrl+Enter` для отправки.
- Timeline: свёрнут по умолчанию, кнопка-expand показывает `TaskEvent` список с типом, датой и payload.

**Paused-state:**
- Кнопка «Новая задача» disabled с tooltip «Создание недоступно при паузе интеграций».
- В модале и drawer все write-кнопки/inputs disabled при `isPaused`.
- Показывается amber-баннер аналогично Orders.tsx.

**Связка из Orders:**
- В `OrderDetailDrawer` (Orders.tsx) добавлена кнопка «Создать задачу» → открывает `QuickCreateModal` с prefill `title = "Заказ <marketplaceOrderId> — "` и `relatedOrderId = orderId`.
- В `OrderDetailDrawer` добавлена секция «Связанные задачи» — загружает `GET /tasks?relatedOrderId=...&status=OPEN,IN_PROGRESS,WAITING&limit=10`, показывает список со статус-badge.

**Роутинг и навигация:**
- Маршрут `/app/tasks` зарегистрирован в `App.tsx`.
- Пункт «Задачи» с иконкой `ClipboardList` добавлен в десктоп-сайдбар и мобильную навигацию `MainLayout.tsx`.

**API:** все запросы через единый `axios` клиент с `baseURL = /api` (без прямых вызовов к маркетплейсам).
