# TASK_ADMIN_7 — QA, Regression и Observability Admin

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_ADMIN_1`
  - `TASK_ADMIN_2`
  - `TASK_ADMIN_3`
  - `TASK_ADMIN_4`
  - `TASK_ADMIN_5`
  - `TASK_ADMIN_6`
- Что нужно сделать:
  - покрыть тестами tenant search, tenant 360 load, extend trial, set access state, restore tenant, password reset, notes;
  - проверить обязательный reason и запрет high-risk actions без него;
  - покрыть кейсы `SUPPORT_READONLY` vs `SUPPORT_ADMIN`;
  - добавить сценарии forbidden billing override и forbidden impersonation;
  - завести метрики и алерты по support actions, denied attempts, anomalous tenant access breadth и note creation.
- Критерий закрытия:
  - регрессии по support RBAC и high-risk contracts ловятся автоматически;
  - observability показывает качество и безопасность support operations;
  - QA matrix покрывает утвержденную MVP admin policy.

**Что сделано**

- Не выполнено.
