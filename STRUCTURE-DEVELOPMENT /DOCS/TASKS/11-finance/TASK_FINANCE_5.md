# TASK_FINANCE_5 — Tenant-State Guards, Source-of-Truth Policy и Stale Handling

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_FINANCE_2`
  - `TASK_FINANCE_3`
  - согласованы `02-tenant`, `08-marketplace-accounts`, `09-sync`
- Что нужно сделать:
  - заблокировать rebuild при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - оставить finance snapshots доступными для чтения при paused tenant;
  - закрепить source-of-truth policy: revenue/sold_qty только из `orders`, fees/logistics только из finance feeds, manual input только в product profile;
  - различать stale state по источникам и incomplete state по missing components;
  - синхронизировать поведение finance с analytics и billing/access policy.
- Критерий закрытия:
  - finance не тянет новые внешние данные в обход tenant policy;
  - source-of-truth policy однозначна и не допускает ручной подмены revenue/fees;
  - stale и incomplete не смешиваются в runtime semantics.

**Что сделано**

- Не выполнено.
