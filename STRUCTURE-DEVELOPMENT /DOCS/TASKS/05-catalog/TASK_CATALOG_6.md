# TASK_CATALOG_6 — Frontend Catalog, Import UX и Unresolved States

> Модуль: `05-catalog`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_CATALOG_2`
  - `TASK_CATALOG_3`
  - `TASK_CATALOG_4`
  - `TASK_CATALOG_5`
- Что нужно сделать:
  - доработать список товаров, карточку, фильтры, пагинацию, статусы `active/deleted`;
  - собрать UX для import preview/commit, invalid rows, duplicate conflicts и unmatched mappings;
  - показать предупреждение при reuse SKU soft-deleted товара;
  - отобразить read-only catalog state при `TRIAL_EXPIRED` и blocked state при `SUSPENDED/CLOSED`;
  - связать catalog UI с files/media и unresolved mapping workflows.
- Критерий закрытия:
  - пользователь понимает duplicate/import/archive сценарии на предметном языке;
  - import и mappings не требуют ручного “угадывания” системных состояний;
  - UI соответствует backend guard и product lifecycle.

**Что сделано**

- Не выполнено.
