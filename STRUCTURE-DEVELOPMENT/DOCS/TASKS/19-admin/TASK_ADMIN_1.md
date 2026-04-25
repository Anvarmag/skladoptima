# TASK_ADMIN_1 — Support Users, RBAC и Internal Control-Plane Boundaries

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `19-admin`
  - согласованы `16-audit`, `13-billing`
- Что нужно сделать:
  - завести `support_users` и role model `support_admin / support_readonly`;
  - реализовать admin RBAC middleware и отдельный internal auth/session контур;
  - изолировать admin-plane от tenant-facing RBAC и tenant picker;
  - запретить SQL-like/manual direct writes в доменные таблицы из admin-панели;
  - закрепить границу internal control plane и допустимых support contracts.
- Критерий закрытия:
  - support роли технически отделены от tenant users;
  - read-only и mutating support scopes не смешиваются;
  - admin контур не создает обходных путей мимо доменных сервисов.

**Что сделано**

- Не выполнено.
