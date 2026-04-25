# TASK_FINANCE_4 — API Table/Detail/Dashboard и Cost Profile Updates

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_FINANCE_1`
  - `TASK_FINANCE_2`
  - `TASK_FINANCE_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/finance/unit-economics`, `GET /api/v1/finance/unit-economics/:productId`, `GET /api/v1/finance/dashboard`;
  - реализовать `PATCH /api/v1/finance/products/:productId/cost`;
  - реализовать `POST /api/v1/finance/snapshots/rebuild` и `GET /api/v1/finance/snapshots/status`;
  - отдавать breakdown по расходным компонентам, `isIncomplete`, warnings и freshness;
  - ограничить update/rebuild действия ролями `Owner/Admin`.
- Критерий закрытия:
  - finance API покрывает table, detail, dashboard и status surfaces;
  - cost profile обновляется без обхода product-level policy;
  - пользователь получает объяснимые breakdown и warning поля.

**Что сделано**

- Не выполнено.
