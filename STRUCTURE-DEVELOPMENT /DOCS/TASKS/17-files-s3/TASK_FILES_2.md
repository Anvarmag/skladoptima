# TASK_FILES_2 — Presigned Upload/Confirm Flow и Validation Rules

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_FILES_1`
- Что нужно сделать:
  - реализовать `POST /api/v1/files/upload-url` и `POST /api/v1/files/confirm`;
  - валидировать RBAC, entity ownership, tenant scope, mime type и размер `<= 10 MB`;
  - разрешить только `jpg/jpeg/png/webp`;
  - создавать `files(status=uploading)` до upload и переводить в `active` после confirm;
  - проверять existence/size/mime/checksum объекта при confirm.
- Критерий закрытия:
  - upload flow безопасен и не требует локальной файловой системы;
  - неподдерживаемые форматы и oversized uploads отклоняются предсказуемо;
  - confirm не активирует отсутствующий или битый объект.

**Что сделано**

- Не выполнено.
