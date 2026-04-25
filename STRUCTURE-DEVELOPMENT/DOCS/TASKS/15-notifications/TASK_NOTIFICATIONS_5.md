# TASK_NOTIFICATIONS_5 — Dedup, Throttle, Tenant-Safe Policy и Future Channel Boundaries

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_NOTIFICATIONS_2`
  - `TASK_NOTIFICATIONS_3`
  - `TASK_NOTIFICATIONS_4`
- Что нужно сделать:
  - реализовать dedup окно по `dedup_key + category + tenant`;
  - реализовать throttling для повторяющихся sync/inventory alerts;
  - не позволять tenant preferences обходить mandatory delivery policy;
  - закрепить `telegram/max` как future-ready границу, без обязательной реализации в MVP;
  - описать совместимость future channels с текущей unified status model.
- Критерий закрытия:
  - повторяющиеся уведомления не превращаются в спам;
  - tenant-safe policy одинакова для всех entrypoints;
  - граница MVP и future channels зафиксирована без архитектурных противоречий.

**Что сделано**

- Не выполнено.
