# TASK_FILES_3 — Signed Access URL, Read Policy и Tenant Isolation

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_FILES_1`
  - `TASK_FILES_2`
- Что нужно сделать:
  - реализовать `GET /api/v1/files/:fileId/access-url`;
  - выдавать только короткоживущий `signed URL` без backend proxy streaming в основном user path;
  - проверять tenant ownership и user RBAC перед выдачей ссылки;
  - заблокировать cross-tenant access технически и прикладно;
  - обеспечить private storage model без публичного bucket path.
- Критерий закрытия:
  - user-facing доступ идет через signed URL и не становится постоянной публичной ссылкой;
  - межтенантный доступ невозможен;
  - read policy соответствует access-state и RBAC.

**Что сделано**

- Не выполнено.
