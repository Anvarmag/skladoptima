# TASK_CATALOG_6 — Frontend Catalog, Import UX и Unresolved States

> Модуль: `05-catalog`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_CATALOG_2`
  - `TASK_CATALOG_3`
  - `TASK_CATALOG_4`
  - `TASK_CATALOG_5`
- Что нужно сделать:
  - доработать список товаров, карточку, фильтры, пагинацию, статусы `active/deleted`;
  - собрать UX для import preview/commit, invalid rows, duplicate conflicts и unmatched mappings;
  - показать предупреждение при reuse SKU soft-deleted товара;
  - отобразить read-only catalog state при `TRIAL_EXPIRED` и blocked state при `SUSPENDED/CLOSED`;
  - связать catalog UI с files/media и unresolved mapping workflows.
- Критерий закрытия:
  - пользователь понимает duplicate/import/archive сценарии на предметном языке;
  - import и mappings не требуют ручного “угадывания” системных состояний;
  - UI соответствует backend guard и product lifecycle.

**Что сделано**

### Backend изменения

**`apps/api/src/modules/catalog/product.controller.ts`**
- Добавлен query-параметр `status` в `GET /products`.

**`apps/api/src/modules/catalog/product.service.ts`**
- `findAll` принимает необязательный параметр `status`.
- При `status='deleted'` фильтрует по `status=DELETED, deletedAt != null`.
- В остальных случаях поведение прежнее — только активные товары.

### Frontend изменения

**`apps/web/src/pages/Products.tsx`** — полный рефакторинг:

1. **Access State (read-only режим)**
   - Подключён `useAuth()`, из него читается `activeTenant.accessState`.
   - `isReadOnly = true` при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.
   - В read-only: кнопки создания, импорта, удаления, редактирования и корректировки остатков скрыты.
   - В шапке таблицы показывается подпись «только чтение».
   - `AccessStateBanner` отображается вверху страницы при непустом `accessState`.

2. **Фильтр статуса (Активные / Архив)**
   - Таб-переключатель «Активные» / «Архив» над таблицей.
   - При режиме «Архив» запрос к `GET /products?status=deleted`.
   - Архивные строки показывают дату удаления вместо остатков/маркетплейс-данных.
   - В режиме «Архив» вместо кнопок действий — кнопка «Восстановить» (`POST /products/:id/restore`).
   - В режиме «Активные» кнопка «Удалить» переименована в «Архивировать» (семантически соответствует soft delete).

3. **SKU reuse — 2-шаговое подтверждение**
   - `handleSave` перехватывает 409 `SKU_SOFT_DELETED`.
   - Открывает модальное окно с описанием ситуации на предметном языке: «Товар с артикулом X ранее был удалён. Создать новую карточку?»
   - При подтверждении повторно вызывает `POST /products` с `confirmRestoreId`.
   - Ошибки `SKU_ALREADY_EXISTS` отображаются в форме вместо `alert()`.

4. **Новый Import UX — preview/commit**
   - Кнопка «Импорт Excel» (заменяет «Импорт WB»).
   - Excel парсится в строки формата `ImportRowDto` (`sku`, `name`, `brand`, `barcode`, `category`).
   - Строки отправляются на `POST /catalog/imports/preview` — создаётся import job.
   - Открывается модальное окно предпросмотра:
     - Сводка: «Создать X / Обновить Y / Требует проверки Z / Пропустить W».
     - Таблица с каждой строкой, action-бейджем и предупреждениями.
     - Строки `MANUAL_REVIEW` подсвечены красным с описанием ошибки.
     - Строки с `source_conflict` показывают amber-предупреждение «Перезапишет ручные изменения».
   - Кнопка «Применить» вызывает `POST /catalog/imports/commit` с идемпотентным ключом.
   - После commit показывается зелёный баннер с итогами: создано / обновлено / ошибок.

5. **Бейдж несопоставленных маппингов**
   - При загрузке страницы запрашивается `GET /catalog/mappings/unmatched?page=1&limit=1`.
   - Если `meta.total > 0` — рядом с заголовком отображается amber-бейдж «N без маппинга».
   - Бейдж обновляется после commit импорта.

6. **Расширенный Product interface**
   - Добавлены поля: `status`, `brand`, `category`, `deletedAt`, `sourceOfTruth`.
   - В таблице показывается бренд и source-of-truth бейдж (`import` / `sync`) под названием товара.

7. **Прочие улучшения**
   - `fetchProducts` завёрнут в `useCallback` с правильными зависимостями.
   - Поиск и статус-фильтр сбрасывают `page` на 1 при изменении.
   - Пустой архив показывает «Архив пуст.» вместо «Товары не найдены.».
