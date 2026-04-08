# TASK_CATALOG_3 — Import Preview, Commit и Idempotency

> Модуль: `05-catalog`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_CATALOG_1`
  - `TASK_CATALOG_2`
  - согласован `18-worker`
- Что нужно сделать:
  - реализовать `imports/preview`, `imports/commit`, `GET import job`;
  - построить preview и commit на одной нормализованной модели;
  - вычислять `create/update/skip/manual_review` для строк;
  - сделать commit идемпотентным по `idempotency_key`;
  - учесть SKU soft-deleted товара по той же policy, что и ручной create.
- Критерий закрытия:
  - import preview и commit предсказуемо совпадают по решениям;
  - повторный commit не создает дубли;
  - import errors и статистика читаемы и пригодны для UX.

**Что сделано**

- Не выполнено.
