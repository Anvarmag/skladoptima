# TASK_TEAM_3 — Accept Invite для Existing/New User и Auth Auto-Link

> Модуль: `03-team`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_TEAM_1`
  - `TASK_TEAM_2`
  - согласован `01-auth`
- Что нужно сделать:
  - реализовать `POST /team/invitations/:token/accept`;
  - поддержать existing user flow через login и new user flow через register + verify;
  - использовать pending invite auto-link после регистрации и verify;
  - валидировать token, TTL, status, tenant scope и `verified email match`;
  - делать accept идемпотентным при повторном открытии уже использованной ссылки.
- Критерий закрытия:
  - invite корректно принимается существующим и новым пользователем;
  - mismatch по verified email блокирует доступ;
  - auto-link invite после auth работает без ручных обходов.

**Что сделано**

- Не выполнено.
