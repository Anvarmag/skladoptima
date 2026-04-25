# TASK_INVENTORY_2 — Manual Adjustments, History и Low-Stock Settings

> Модуль: `06-inventory`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_INVENTORY_1`
- Что нужно сделать:
  - реализовать `GET stocks`, `GET movements`, `POST adjustments`, `GET low-stock`, `PATCH threshold`;
  - поддержать adjustment по `delta` или target quantity с обязательным reason/comment;
  - писать movement history в той же транзакции, что и изменение остатка;
  - полностью запретить уход в отрицательный `on_hand`;
  - подготовить low-stock integration контракт для notifications.
- Критерий закрытия:
  - ручные корректировки атомарны и трассируемы;
  - negative stock невозможен;
  - пользователь видит остаток, резерв и причину изменения.

**Что сделано**

- Не выполнено.
