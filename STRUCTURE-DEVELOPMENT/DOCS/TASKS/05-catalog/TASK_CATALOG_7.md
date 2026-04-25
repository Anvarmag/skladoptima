# TASK_CATALOG_7 — QA, Regression и Observability Catalog

> Модуль: `05-catalog`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_CATALOG_2`
  - `TASK_CATALOG_3`
  - `TASK_CATALOG_4`
  - `TASK_CATALOG_5`
  - `TASK_CATALOG_6`
- Что нужно сделать:
  - собрать regression пакет на create/update/delete/restore, import preview/commit, auto/manual match, duplicate merge;
  - покрыть SKU conflicts, soft-deleted SKU reuse confirm, import idempotency и source-of-change conflicts;
  - проверить поведение каталога в `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - проверить, что audit формируется для create/update/delete/restore/import/mapping/merge сценариев;
  - настроить метрики, логи и alerts по import health, mapping conflicts и write denials.
- Критерий закрытия:
  - catalog модуль подтвержден проверяемой регрессией;
  - критичные data integrity risks закрыты тестами;
  - observability достаточна для расследования import/mapping инцидентов;
  - audit и тесты вместе покрывают ключевые расследуемые catalog flows.

**Что сделано**

- Не выполнено.
