# TASK_MARKETPLACE_ACCOUNTS_6 — Frontend Connection UX и Diagnostics

> Модуль: `08-marketplace-accounts`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_2`
  - `TASK_MARKETPLACE_ACCOUNTS_4`
  - `TASK_MARKETPLACE_ACCOUNTS_5`
- Что нужно сделать:
  - собрать список account с индикаторами `lifecycle`, `credential`, `sync health`;
  - реализовать create/edit form с masked credential preview и безопасным обновлением секретов;
  - вывести diagnostics panel с причинами `invalid`, `needs_reconnect`, `degraded`, `paused`;
  - корректно блокировать actions в `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - сделать ясный UX для single active account per marketplace.
- Критерий закрытия:
  - пользователь понимает, account неактивен из-за credentials, sync health или tenant policy;
  - UI не показывает запрещенные action buttons;
  - reconnect/edit flows не требуют повторного ввода всех secret-полей без необходимости.

**Что сделано**

- Не выполнено.
