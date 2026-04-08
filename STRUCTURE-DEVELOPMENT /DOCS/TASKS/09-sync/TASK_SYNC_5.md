# TASK_SYNC_5 — Worker Execution Pipeline и Downstream Handoff

> Модуль: `09-sync`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `11h`
- Зависимости:
  - `TASK_SYNC_1`
  - `TASK_SYNC_3`
  - `TASK_SYNC_4`
  - согласованы `18-worker`, `05-catalog`, `06-inventory`, `10-orders`, `07-warehouses`
- Что нужно сделать:
  - собрать pipeline `pull metadata -> pull orders/stocks -> transform/apply -> push`;
  - реализовать retry/backoff/circuit-breaker поведение на уровне worker;
  - обновлять `last_sync_at`, `sync_health_status` и summary по account после завершения run;
  - обеспечить корректный handoff в catalog/orders/inventory/warehouses без смешивания доменных правил;
  - отделить technical failure от policy-block и adapter auth failure.
- Критерий закрытия:
  - worker исполняет run воспроизводимо и не смешивает типы ошибок;
  - downstream эффекты применяются через согласованные контракты;
  - run summary корректно отражает partial success, failed и blocked cases.

**Что сделано**

- Не выполнено.
