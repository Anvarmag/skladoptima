# TASK_TENANT_2 — Create Tenant, Settings Bootstrap и Owner Membership

> Модуль: `02-tenant`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TENANT_1`
  - готов auth context из `01-auth`
- Что нужно сделать:
  - реализовать `POST /tenants`;
  - валидировать `name`, `inn`, `tax_system`, `country`, `currency`, `timezone`;
  - в одной транзакции создавать tenant, settings и owner membership;
  - выставлять `TRIAL_ACTIVE` как стартовый access state;
  - обновлять `last_used_tenant_id` и писать audit/access-state event.
- Критерий закрытия:
  - пользователь без компании может создать tenant и получить рабочий контекст;
  - ИНН проверяется и защищен от дублей;
  - bootstrap после создания согласован с `auth/onboarding`.

**Что сделано**

- Не выполнено.
