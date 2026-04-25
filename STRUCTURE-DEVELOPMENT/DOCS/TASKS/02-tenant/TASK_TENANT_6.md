# TASK_TENANT_6 — Closed Tenant Lifecycle, Restore и Retention

> Модуль: `02-tenant`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_TENANT_1`
  - `TASK_TENANT_5`
  - согласован `19-admin`
- Что нужно сделать:
  - реализовать перевод tenant в `CLOSED` и создание `tenant_closure_job`;
  - оставить закрытый tenant видимым в picker/history как недоступный;
  - реализовать restore `CLOSED` tenant в пределах retention window;
  - освобождать ИНН только после retention и фактического удаления данных;
  - учесть support/admin сценарии и audit trail.
- Критерий закрытия:
  - закрытие tenant не создает “полузакрытого” состояния;
  - restore работает только в допустимом окне;
  - UI и backend согласованы по видимости закрытой компании и CTA на поддержку.

**Что сделано**

- Не выполнено.
