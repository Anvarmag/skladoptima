# TASK_ADMIN_3 — Support Actions API и Domain-Contract Execution

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_ADMIN_1`
  - `TASK_ADMIN_2`
  - согласованы `02-tenant`, `13-billing`, `01-auth`
- Что нужно сделать:
  - реализовать support actions: `extend trial`, `set access state`, `restore tenant`, `trigger password reset`, `add internal note`;
  - реализовать `POST /api/v1/admin/tenants/:tenantId/actions/extend-trial`, `set-access-state`, `restore-tenant`;
  - реализовать `POST /api/v1/admin/users/:userId/actions/password-reset`;
  - исполнять все mutating actions только через доменные сервисы и контракты;
  - требовать `reason` длиной >= 10 символов для high-risk actions.
- Критерий закрытия:
  - support actions ограничены утвержденным MVP-набором;
  - high-risk actions не обходят доменные правила;
  - каждое действие имеет валидируемый reason и воспроизводимый execution path.

**Что сделано**

- Не выполнено.
