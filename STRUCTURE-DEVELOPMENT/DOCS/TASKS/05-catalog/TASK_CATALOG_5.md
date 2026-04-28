# TASK_CATALOG_5 — Source-of-Change Policy и Tenant-State Guards

> Модуль: `05-catalog`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_CATALOG_2`
  - `TASK_CATALOG_3`
  - `TASK_CATALOG_4`
  - согласованы `02-tenant`, `09-sync`
- Что нужно сделать:
  - закрепить `source_of_truth` и source-of-change policy между `manual`, `import`, `sync`;
  - не допускать silent overwrite master-полей через sync-layer;
  - заблокировать все catalog write-actions при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - одинаково применять guard ко всем entrypoint: UI, import, sync-driven flows;
  - диагностировать конфликт ручного изменения и import/sync update;
  - писать audit на create/update/delete/restore/import commit/manual mapping/duplicate merge.
- Критерий закрытия:
  - source-of-change работает как явная policy, а не как неявное поведение;
  - tenant-state guards одинаково защищают CRUD/import/mapping;
  - каталог не расходится с read-only политикой tenant;
  - audit trail позволяет разобрать ключевые catalog changes и source-of-change конфликты.

**Что сделано**

Реализована source-of-change policy и усилен аудит-трейл для всего каталогового flow.

### Миграция

**`apps/api/prisma/migrations/20260426080000_catalog_source_policy/migration.sql`**
- `ALTER TYPE "ActionType" ADD VALUE 'IMPORT_COMMITTED'` — новый тип для сводного аудита import commit.

**`apps/api/prisma/schema.prisma`** — добавлен `IMPORT_COMMITTED` в enum `ActionType`.

### `import.service.ts` — полная переработка с AuditService

**Source-conflict detection в `preview`:**
- Батч-запрос теперь включает `sourceOfTruth` для каждого найденного продукта.
- В `_resolveAction`: если существующий продукт имеет `sourceOfTruth = MANUAL` и action = UPDATE, в `validationErrors` добавляется запись `{type: 'source_conflict', field: 'sourceOfTruth', message: '...', existingSource: 'MANUAL'}`.
- Preview-ответ теперь содержит для каждой строки: `errors` (только валидационные ошибки) и `sourceConflict` (отдельное поле, null если конфликта нет). Это позволяет UI показывать предупреждение без блокировки действия.
- Source-conflict сохраняется в JSONB поле `validationErrors` → доступен при `GET /catalog/imports/:jobId`.

**Аудит в `commit`:**
- `commit` принимает дополнительный параметр `actorEmail`.
- `_applyCreate` и `_applyUpdate` логируют `PRODUCT_CREATED` / `PRODUCT_UPDATED` для каждого затронутого товара.
- Для UPDATE с source-conflict в поле `note` явно указывается: `"Import overwrote MANUAL product (source conflict) via import commit"` — конфликт диагностируем через audit trail.
- По завершению commit пишется сводный `IMPORT_COMMITTED`: `"jobId=...; created=N, updated=N, errors=N, sourceConflicts=N"`.
- AuditService инжектируется в ImportService через ProductModule (который уже импортирует AuditModule).

### `import.controller.ts`

- Метод `commit` теперь передаёт `req.user?.email` как `actorEmail` в сервис.

### `product.service.ts` — source-of-change защита в `importFromWb`

Метод `importFromWb` (sync-driven legacy endpoint) обновлён:

- **Защита от sync-overwrite**: перед обновлением существующего продукта проверяется `sourceOfTruth`. Если значение != `SYNC` (т.е. `MANUAL` или `IMPORT`) — продукт пропускается с `logger.warn` (`sync_source_conflict_skipped`). Sync-layer не должен перезаписывать master-управляемые карточки.
- **Новые продукты**: создаются с `sourceOfTruth = SYNC` (было `IMPORT` — исправлена ошибка: legacy sync создавал товары с неправильным sourceOfTruth).
- **Ответ**: добавлено поле `skipped` (кол-во пропущенных из-за source conflict).

### Состояние guard-покрытия (проверено)

| Entrypoint | TenantWriteGuard |
|-----------|-----------------|
| `POST /products` | ✓ |
| `PATCH /products/:id` | ✓ |
| `PUT /products/:id` | ✓ |
| `DELETE /products/:id` | ✓ |
| `POST /products/:id/restore` | ✓ |
| `POST /products/:id/stock-adjust` | ✓ |
| `POST /products/import` (legacy sync) | ✓ |
| `POST /catalog/imports/preview` | ✓ |
| `POST /catalog/imports/commit` | ✓ |
| `POST /catalog/mappings/manual` | ✓ |
| `POST /catalog/mappings/auto-match` | ✓ |
| `POST /catalog/mappings/merge` | ✓ |
| `DELETE /catalog/mappings/:id` | ✓ |

Все write-entrypoints покрыты `TenantWriteGuard`, который блокирует запросы при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.

### Ключевые свойства

- **Source conflict диагностируем, не блокирует**: пользователь видит предупреждение в preview, commit пишет конфликт в audit trail с описательным note.
- **Sync-layer не перезаписывает MANUAL/IMPORT продукты**: `importFromWb` теперь пропускает их (было silent overwrite).
- **Полный audit trail**: create/update через import commit → `PRODUCT_CREATED`/`PRODUCT_UPDATED` + `IMPORT_COMMITTED` на весь job.
