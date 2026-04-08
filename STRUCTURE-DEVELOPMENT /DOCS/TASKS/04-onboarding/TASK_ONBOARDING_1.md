# TASK_ONBOARDING_1 — Data Model, Bootstrap Scopes и Versioning

> Модуль: `04-onboarding`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - утверждена системная аналитика `04-onboarding`
- Что нужно сделать:
  - завести `onboarding_states` и `onboarding_step_progress`;
  - поддержать два scope: `user_bootstrap` и `tenant_activation`;
  - предусмотреть `status`, `last_step_key`, `version` и историю шагов;
  - зафиксировать модель перехода от user-bootstrap к tenant-scoped state без потери прогресса;
  - заложить versioning каталога шагов для будущих изменений onboarding.
- Критерий закрытия:
  - модель данных соответствует `04-onboarding`;
  - bootstrap до создания tenant не теряется;
  - состояние шагов устойчиво к изменениям продуктового каталога.

**Что сделано**

- Не выполнено.
