# TASK_AUTH_5 — Security Hardening, Rate Limits, Soft-Lock и Audit Events

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_AUTH_2`
  - `TASK_AUTH_3`
  - `TASK_AUTH_4`
  - согласован модуль `16-audit`
- Что нужно сделать:
  - ввести rate limiting для `login`, `resend-verification`, `forgot-password`;
  - реализовать soft-lock: `5` подряд неуспешных попыток для пары `normalized_email + IP` на `15 минут`;
  - не использовать CAPTCHA в MVP;
  - сделать нейтральные ошибки без утечки существования account;
  - писать auth/security events: login success/failed, verify, reset requested/completed, password changed, session revoked, logout-all.
- Критерий закрытия:
  - критичные auth endpoints защищены от abuse;
  - soft-lock работает по согласованной политике;
  - audit/security telemetry достаточна для расследований.

**Что сделано**

- Не выполнено.
