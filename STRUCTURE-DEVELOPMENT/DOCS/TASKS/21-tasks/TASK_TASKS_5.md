# TASK_TASKS_5 — Frontend Inbox, Kanban и quick-create UX

> Модуль: `21-tasks`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
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

- Не выполнено.
