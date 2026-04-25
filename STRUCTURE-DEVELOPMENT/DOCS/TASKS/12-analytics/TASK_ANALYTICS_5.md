# TASK_ANALYTICS_5 — Tenant-State Guards, Freshness/Incomplete Policy и Source Contracts

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ANALYTICS_2`
  - `TASK_ANALYTICS_3`
  - `TASK_ANALYTICS_4`
  - согласованы `02-tenant`, `09-sync`, `11-finance`
- Что нужно сделать:
  - заблокировать rebuild при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - оставить analytics snapshots доступными для чтения при paused tenant;
  - различать `fresh`, `stale`, `incomplete` как разные состояния;
  - не допускать runtime integration refresh из analytics слоя;
  - закрепить source contracts с orders, finance, catalog, inventory без обходных источников.
- Критерий закрытия:
  - analytics не конфликтует с guards из sync и finance;
  - stale и incomplete semantics не смешиваются;
  - read-only режим при paused tenant работает предсказуемо.

**Что сделано**

- Не выполнено.
