# TASK_WAREHOUSES_7 — QA, Regression и Observability Warehouses

> Модуль: `07-warehouses`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `7h`
- Зависимости:
  - `TASK_WAREHOUSES_2`
  - `TASK_WAREHOUSES_3`
  - `TASK_WAREHOUSES_4`
  - `TASK_WAREHOUSES_5`
  - `TASK_WAREHOUSES_6`
- Что нужно сделать:
  - собрать regression пакет на первичную загрузку, upsert без дублей, исчезновение склада, lifecycle `ACTIVE -> INACTIVE -> ARCHIVED`;
  - покрыть изменение alias/labels без влияния на sync identity;
  - проверить сценарий, где marketplace account перестает быть operational source, но warehouse links сохраняются как reference history;
  - проверить поведение при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - проверить, что audit формируется для alias/labels updates;
  - настроить метрики, логи и alerts по freshness lag, classification changes и warehouse sync failures.
- Критерий закрытия:
  - warehouse reference layer подтвержден проверяемой регрессией;
  - исторические и активные склады корректно различаются;
  - observability достаточна для расследования sync/normalization проблем;
  - audit и тесты покрывают локальные metadata changes и account-related warehouse lifecycle.

**Что сделано**

- Не выполнено.
