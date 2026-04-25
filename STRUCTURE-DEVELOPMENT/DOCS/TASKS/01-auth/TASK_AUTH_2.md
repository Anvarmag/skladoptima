# TASK_AUTH_2 — Register, Verify Email, Resend и Invite Auto-Link

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUTH_1`
  - готов delivery-контур email/notifications
- Что нужно сделать:
  - реализовать `register`, `verify-email`, `resend-verification`;
  - полностью запретить login до подтверждения email;
  - добавить lifecycle verify token: active, used, expired;
  - реализовать auto-link pending invite после успешной регистрации и verify;
  - обработать already-verified, expired token и повторный resend без утечки лишней информации.
- Критерий закрытия:
  - пользователь может зарегистрироваться и подтвердить email сквозным потоком;
  - неподтвержденный пользователь не может войти;
  - pending invite корректно привязывается автоматически после verify.

**Что сделано**

- Не выполнено.
