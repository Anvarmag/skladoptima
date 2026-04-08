# TASK_ONBOARDING_4 — Step Catalog, Domain Events и Auto-Complete

> Модуль: `04-onboarding`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ONBOARDING_1`
  - `TASK_ONBOARDING_2`
  - согласованы `08-marketplace-accounts`, `09-sync`
- Что нужно сделать:
  - зафиксировать каталог шагов `welcome`, `setup_company`, `connect_marketplace`, `import_catalog`, `run_first_sync`, `open_support`;
  - реализовать source-aware step updates: `user_action`, `domain_event`, `migration`;
  - настроить автозавершение шагов по доменным событиям, например `marketplace account connected`, `first sync success`;
  - разделить рекомендуемые и необязательные шаги без блокировки работы приложения;
  - завести event tracking `opened/step_viewed/skipped/completed`.
- Критерий закрытия:
  - шаги живут по фиксированному каталогу;
  - auto-complete работает по факту действия, а не только по кнопке;
  - completion metric не искажается смешением обязательных и рекомендательных шагов.

**Что сделано**

- Не выполнено.
