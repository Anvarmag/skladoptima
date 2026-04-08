# TASK_FILES_5 — Access-State Guards, Catalog Linkage и Audit

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_FILES_2`
  - `TASK_FILES_3`
  - `TASK_FILES_4`
  - согласованы `02-tenant`, `05-catalog`, `16-audit`
- Что нужно сделать:
  - при `TRIAL_EXPIRED` разрешить только read существующих активных файлов;
  - при `TRIAL_EXPIRED` блокировать upload/replace/delete как write-операции;
  - при `SUSPENDED/CLOSED` блокировать user-facing access-url и любые write-actions;
  - согласовать linkage с `catalog.main_image_file_id` для модели `single main image per product`;
  - писать audit на upload/confirm/replace/delete и критичные cleanup decisions.
- Критерий закрытия:
  - files module не обходит tenant access policy;
  - связь с catalog стабильна и не создает битых product references;
  - audit покрывает ключевые file lifecycle changes.

**Что сделано**

- Не выполнено.
