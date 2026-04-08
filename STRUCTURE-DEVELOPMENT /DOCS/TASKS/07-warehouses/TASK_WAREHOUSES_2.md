# TASK_WAREHOUSES_2 — Sync и Import Справочника Складов

> Модуль: `07-warehouses`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_WAREHOUSES_1`
  - согласованы `08-marketplace-accounts` и `09-sync`
- Что нужно сделать:
  - реализовать sync use-case получения складов из marketplace account API;
  - нормализовать внешние ответы в канонический warehouse DTO;
  - делать upsert по `(tenant, account, external_id)` без дублей;
  - переводить пропавшие склады сначала в `INACTIVE`, затем в `ARCHIVED` по safe-window policy;
  - учитывать lifecycle marketplace account: если account перестал быть operational source, warehouse reference не удаляется, а корректно уходит в неактуальное состояние по policy;
  - не удалять исторические reference links при исчезновении склада из API.
- Критерий закрытия:
  - первичная загрузка и повторный sync работают идемпотентно;
  - disappeared warehouses проходят согласованный lifecycle;
  - внешний source-of-truth сохраняется без ручных искажений;
  - account state не приводит к silent loss warehouse references.

**Что сделано**

- Не выполнено.
