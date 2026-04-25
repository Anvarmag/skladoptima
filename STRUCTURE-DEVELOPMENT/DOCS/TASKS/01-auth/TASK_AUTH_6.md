# TASK_AUTH_6 — Frontend Auth Flows и Post-Login Routing

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUTH_2`
  - `TASK_AUTH_3`
  - `TASK_AUTH_4`
  - согласованы `02-tenant` и `04-onboarding`
- Что нужно сделать:
  - собрать UI для `/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`;
  - отобразить verify-required states, resend CTA и neutral forgot UX;
  - реализовать protected routing и post-login redirect;
  - направлять пользователя без tenant в согласованный `auth -> onboarding` flow;
  - учесть состояния multi-tenant пользователя, active tenant и read-only/blocked auth UX.
- Критерий закрытия:
  - entry flow работает без тупиков;
  - post-login маршрут предсказуем и согласован с `tenant/onboarding`;
  - все базовые пользовательские состояния покрыты в UI.

**Что сделано**

- Не выполнено.
