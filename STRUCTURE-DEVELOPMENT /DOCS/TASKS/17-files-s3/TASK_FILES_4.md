# TASK_FILES_4 — Replace/Delete Flow, Cleanup Lifecycle и Reconciliation

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_FILES_1`
  - `TASK_FILES_2`
  - `TASK_FILES_3`
  - согласован `18-worker`
- Что нужно сделать:
  - реализовать `POST /api/v1/files/:fileId/replace` и `DELETE /api/v1/files/:fileId`;
  - при replace атомарно переключать доменную ссылку на новый `file_id`;
  - переводить старые/удаленные/неподтвержденные файлы в cleanup lifecycle;
  - реализовать cleanup/reconcile jobs для `replaced`, `orphaned`, `deleted` файлов;
  - закрепить retention window = `7 дней` для `replaced / orphaned / deleted`.
- Критерий закрытия:
  - replace flow не ломает карточку товара;
  - orphan/replaced files не висят бесконтрольно;
  - broken record/object references выявляются и диагностируются через reconciliation.

**Что сделано**

- Не выполнено.
