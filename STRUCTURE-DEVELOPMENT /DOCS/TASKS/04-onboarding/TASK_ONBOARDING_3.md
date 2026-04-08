# TASK_ONBOARDING_3 — Bootstrap-to-Tenant Handoff после Создания Компании

> Модуль: `04-onboarding`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_ONBOARDING_1`
  - `TASK_ONBOARDING_2`
  - согласованы `01-auth` и `02-tenant`
- Что нужно сделать:
  - после login без tenant создавать или читать `user_bootstrap` onboarding state;
  - вести `setup_company` как рекомендуемый стартовый шаг, но не обязательный;
  - после создания tenant мигрировать или связывать прогресс с `tenant_activation` state;
  - не терять `viewed/skipped/done` историю при handoff;
  - согласовать handoff с post-login routing и tenant bootstrap.
- Критерий закрытия:
  - первый пользовательский вход без tenant не теряет onboarding контекст;
  - создание компании мягко переводит onboarding в tenant-scoped режим;
  - рекомендательный характер `setup_company` сохранен.

**Что сделано**

- Не выполнено.
