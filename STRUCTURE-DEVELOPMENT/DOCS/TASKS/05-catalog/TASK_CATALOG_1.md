# TASK_CATALOG_1 — Data Model, Master Product и Channel Mappings

> Модуль: `05-catalog`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `05-catalog`
- Что нужно сделать:
  - завести `products`, `product_channel_mappings`, `catalog_import_jobs`, `catalog_import_job_items`;
  - закрепить master product model с единым внутренним SKU и множественными channel mappings;
  - ввести ограничения `UNIQUE(tenant_id, sku)` и `UNIQUE(tenant_id, marketplace, external_product_id)`;
  - предусмотреть поля `source_of_truth`, `main_image_file_id`, lifecycle `active/deleted`, а также служебные поля `created_by`, `updated_by`, `deleted_at`;
  - явно закрепить provenance для mapping/import сущностей, чтобы источник строки и канал изменения восстанавливались без ручной реконструкции;
  - согласовать модель с `inventory`, `orders`, `finance`, `files`.
- Критерий закрытия:
  - data model соответствует `05-catalog`;
  - master product и external mapping не смешиваются;
  - constraints защищают SKU integrity и mapping uniqueness;
  - по данным можно восстановить, кто и каким путем изменил master-каталог.

**Что сделано**

- Не выполнено.
