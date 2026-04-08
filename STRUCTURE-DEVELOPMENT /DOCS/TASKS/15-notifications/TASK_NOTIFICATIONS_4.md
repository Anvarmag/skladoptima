# TASK_NOTIFICATIONS_4 — Preferences API, Inbox API и Channel Status Surfaces

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_NOTIFICATIONS_1`
  - `TASK_NOTIFICATIONS_2`
  - `TASK_NOTIFICATIONS_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/notifications`, `PATCH /api/v1/notifications/:id/read`;
  - реализовать `GET/PATCH /api/v1/notifications/preferences`;
  - реализовать `GET /api/v1/notifications/status`;
  - валидировать preferences payload и запрет на полное отключение mandatory alerts;
  - подготовить status surfaces для channel health и configuration readiness.
- Критерий закрытия:
  - inbox и preferences покрыты стабильным API;
  - owner получает управляемые настройки в допустимых пределах;
  - статус каналов и delivery health объясним для пользователя и support.

**Что сделано**

- Не выполнено.
