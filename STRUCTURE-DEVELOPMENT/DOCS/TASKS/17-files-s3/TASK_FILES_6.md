# TASK_FILES_6 — Frontend Product Media UX и Upload States

> Модуль: `17-files-s3`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_FILES_2`
  - `TASK_FILES_3`
  - `TASK_FILES_4`
  - `TASK_FILES_5`
- Что нужно сделать:
  - реализовать product media UX для `single main image`;
  - показать состояния upload, confirm, preview, replace и delete без технических деталей storage;
  - отобразить preview существующего фото через signed access flow;
  - скрывать или блокировать upload/replace/delete CTA при `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - не создавать ожидание multi-image gallery в MVP.
- Критерий закрытия:
  - пользователь видит понятный media flow без работы с файловой системой;
  - preview и replace работают предсказуемо;
  - UI строго соответствует MVP scope и tenant-state restrictions.

**Что сделано**

### Создан `apps/web/src/components/ProductMediaWidget.tsx`

Новый React-компонент с полным product media UX:

**Состояния (UploadState):**
- `idle` — отображение текущего фото или placeholder
- `uploading` — spinner «Загрузка...» во время PUT в S3
- `confirming` — spinner «Проверка...» пока бэкенд проверяет объект (POST /files/confirm)
- `deleting` — spinner «Удаление...» во время DELETE /files/:fileId
- `error` — сообщение об ошибке с кнопкой «Закрыть»

**Preview через signed access flow:**
- При наличии `mainImageFileId` компонент на mount вызывает `GET /files/:fileId/access-url`
- Полученный `accessUrl` (короткоживущий presigned GET URL) используется как `src` изображения
- Для legacy-товаров (только поле `photo` без `mainImageFileId`) используется прямой URL — backward compat

**Upload/replace flow (3 шага без технических деталей):**
1. Пользователь выбирает файл через hidden `<input type="file">`
2. Frontend-валидация: MIME (jpg/png/webp), size ≤ 10 МБ — до любого сетевого запроса
3. `POST /files/upload-url` → presigned PUT URL + fileId
4. `fetch(uploadUrl, { method: 'PUT' })` — нативный fetch (не axios) чтобы не добавлять X-CSRF-Token к S3 запросу
5. `POST /files/confirm` → файл становится active, Product.mainImageFileId атомарно обновляется бэкендом
6. `onMediaUpdated(fileId)` — обновляет строку товара в state без перезагрузки списка

**Защита CTA по tenant access-state:**
- `isReadOnly` prop приходит из `WRITE_BLOCKED_STATES` (TRIAL_EXPIRED / SUSPENDED / CLOSED)
- Overlay с upload/replace/delete кнопками полностью скрыт при `isReadOnly`
- Для архивных товаров (`statusFilter === 'deleted'`) также блокируется через `isReadOnly`

**Delete:**
- Кнопка удаления видна только для файлов из files API (`hasFileApiImage` = !!mainImageFileId)
- Legacy-фото (только `photo`) можно заменить через upload, но не удалить через виджет — нет file record

### Изменён `apps/web/src/pages/Products.tsx`

- Добавлен импорт `ProductMediaWidget`
- В интерфейс `Product` добавлено поле `mainImageFileId: string | null`
- Photo-ячейка таблицы заменена на `<ProductMediaWidget>` — убраны `getImageUrl`, `Package` из этой логики
- Добавлен `handleMediaUpdated(productId, newFileId)` — обновляет `mainImageFileId` в local state без re-fetch
- Модал редактирования: файловый input убран из edit-mode, добавлена подсказка «наведите курсор на изображение в таблице»; для create-mode input остался (files API требует entityId, который есть только у существующего товара)
