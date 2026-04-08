# TASK_AUTH_3 — Login, Session Lifecycle, `me`, Logout и `logout-all`

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUTH_1`
  - `TASK_AUTH_2`
- Что нужно сделать:
  - реализовать `login`, `GET /auth/me`, `logout`, `logout-all`;
  - завести server-controlled sessions с rotation/revoke policy;
  - гарантировать, что `logout-all` отзывает все сессии по правилам, согласованным в аналитике;
  - вернуть через `me` нормализованный auth context для downstream routing;
  - учесть trusted tenant context и post-login handoff в `tenant/onboarding`.
- Критерий закрытия:
  - login создает валидную серверную сессию;
  - logout и `logout-all` корректно инвалидируют доступ;
  - `me` отдает пригодный для продукта auth context без неоднозначностей.

**Что сделано**

- Не выполнено.
