# TASK_AUTH_1 — Auth Data Model и миграции

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `01-auth`
- Что нужно сделать:
  - спроектировать и завести таблицы `users`, `auth_sessions`, `email_verification_tokens`, `password_reset_tokens`, `auth_events`, `user_preferences`;
  - зафиксировать ограничения по уникальности email, session family, active token lifecycle и revoke semantics;
  - предусмотреть поля под soft-lock, verify state, invite auto-link и server-side session control;
  - описать порядок миграции со старой auth-моделью без поломки текущего login context.
- Критерий закрытия:
  - схема БД соответствует `01-auth`;
  - миграции воспроизводимы;
  - нет дыр по токенам, сессиям и lifecycle состояниям.

**Что сделано**

- Не выполнено.
