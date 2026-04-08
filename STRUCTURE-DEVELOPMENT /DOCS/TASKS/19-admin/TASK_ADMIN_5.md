# TASK_ADMIN_5 — Security Guardrails, Forbidden Actions и Support Role Separation

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ADMIN_1`
  - `TASK_ADMIN_3`
  - `TASK_ADMIN_4`
  - согласованы `13-billing`, `16-audit`
- Что нужно сделать:
  - запретить `special access / billing override` в MVP;
  - запретить impersonation/login-as-user и доступ к plaintext credentials/passwords;
  - ограничить `SUPPORT_READONLY` только read scenarios;
  - enforce-ить обязательный `reason` и отдельный support audit context для high-risk actions;
  - валидировать `restore-tenant` только для `CLOSED` tenant внутри retention window.
- Критерий закрытия:
  - support контур не создает скрытых override-механик;
  - опасные forbidden actions технически закрыты;
  - разделение `SUPPORT_ADMIN` и `SUPPORT_READONLY` устойчиво и прозрачно.

**Что сделано**

- Не выполнено.
