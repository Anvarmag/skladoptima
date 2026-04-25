# TASK_CATALOG_2 — CRUD Products, Soft Delete и Restore

> Модуль: `05-catalog`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_CATALOG_1`
  - согласован `17-files-s3`
- Что нужно сделать:
  - реализовать create/list/detail/update/delete/restore для товаров;
  - требовать минимум `name + sku` в MVP;
  - реализовать soft delete без потери ссылочной истории зависимых модулей;
  - поддержать reuse SKU после soft delete только через warning + explicit confirm;
  - связать товар с `main_image_file_id` без поломки карточки при замене медиа.
- Критерий закрытия:
  - CRUD работает по agreed contract;
  - soft delete и restore не ломают связанные модули;
  - сценарий reuse SKU после soft delete реализован одинаково и прозрачно.

**Что сделано**

- Не выполнено.
