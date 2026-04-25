# TASK_FINANCE_3 — Snapshot/Read-Model, Rebuild Jobs и Freshness Status

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_FINANCE_1`
  - `TASK_FINANCE_2`
  - согласованы `09-sync`, `18-worker`
- Что нужно сделать:
  - собрать snapshot strategy для периодов `week / month / custom`;
  - реализовать nightly build и on-demand rebuild jobs;
  - хранить `source_freshness` и различать `incomplete data` от `stale snapshot`;
  - обеспечить идемпотентность rebuild по `(tenant, period_from, period_to, formula_version)` или job key;
  - не инициировать внешние sync-вызовы из rebuild, а работать только по внутренним нормализованным источникам.
- Критерий закрытия:
  - finance строится на snapshot/read-model, а не на тяжелых runtime join;
  - stale и incomplete различаются на уровне модели и API;
  - rebuild jobs безопасны, идемпотентны и пригодны для worker orchestration.

**Что сделано**

- Не выполнено.
