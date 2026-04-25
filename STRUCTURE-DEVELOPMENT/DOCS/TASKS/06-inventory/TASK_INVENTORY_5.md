# TASK_INVENTORY_5 — Tenant-State Guards, FBS/FBO Boundaries и Sync Handoff

> Модуль: `06-inventory`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_INVENTORY_2`
  - `TASK_INVENTORY_3`
  - `TASK_INVENTORY_4`
  - согласованы `02-tenant`, `09-sync`
- Что нужно сделать:
  - заблокировать manual write-actions при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - при `TRIAL_EXPIRED` оставить inventory в read-only и поставить marketplace integrations/API calls на паузу;
  - не обрабатывать новые order/sync-driven side-effects из внешних каналов в `TRIAL_EXPIRED`;
  - закрепить, что channel lock/override не входят в MVP;
  - не смешивать FBS master stock и FBO внешний контур в одном управляемом остатке.
- Критерий закрытия:
  - inventory не расходится с tenant commercial policy;
  - FBS/FBO границы понятны и соблюдаются;
  - sync handoff использует только согласованный effective available qty.

**Что сделано**

- Не выполнено.
