# TASK_ONBOARDING_5 — Tenant Access-State Guards и Role-Aware Availability

> Модуль: `04-onboarding`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_ONBOARDING_2`
  - `TASK_ONBOARDING_3`
  - `TASK_ONBOARDING_4`
  - согласованы `02-tenant` и `03-team`
- Что нужно сделать:
  - учитывать tenant `AccessState` при доступности шагов и CTA;
  - при `TRIAL_EXPIRED` оставлять onboarding доступным в read-only виде без write-oriented CTA;
  - при `SUSPENDED` и `CLOSED` вести только в billing/support и не открывать недоступные flows;
  - сохранить единый onboarding для всех ролей, но реальную доступность CTA вычислять по role/context policy;
  - возвращать из backend явный blocked/read-only state для шага.
- Критерий закрытия:
  - onboarding не подсказывает запрещенные действия;
  - `ADMIN/MANAGER` видят тот же flow, но без ложных CTA;
  - tenant-state policy и onboarding не конфликтуют.

**Что сделано**

- Не выполнено.
