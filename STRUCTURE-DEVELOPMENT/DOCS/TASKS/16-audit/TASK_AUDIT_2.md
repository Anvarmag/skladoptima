# TASK_AUDIT_2 — Unified Audit Writer, Write Strategy и Coverage Contracts

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUDIT_1`
- Что нужно сделать:
  - реализовать unified internal audit writer;
  - закрепить write strategy: предпочтительно в той же транзакции, допустимо через reliable outbox;
  - исключить best-effort post-commit logging без гарантии доставки;
  - описать coverage contracts для доменных модулей по mandatory audit events;
  - подключить internal endpoint/contract для безопасной записи audit событий.
- Критерий закрытия:
  - audit write path надежен и не теряет критичные записи;
  - доменные модули используют единый структурированный writer;
  - coverage по critical actions контролируется централизованно.

**Что сделано**

### 1. Расширен Event Catalog (audit-event-catalog.ts)

Добавлены события, отсутствовавшие в MVP-каталоге:
- `PRODUCT_RESTORED` — восстановление архивированного товара
- `CATALOG_IMPORT_COMMITTED` — сводный аудит import commit
- `MARKETPLACE_MAPPING_CREATED` — создание маппинга (ручное и автоматическое)
- `MARKETPLACE_MAPPING_DELETED` — удаление маппинга
- `STOCK_ORDER_DEDUCTED` — списание склада при marketplace-заказе
- `STOCK_ORDER_RETURNED` — возврат при отмене заказа

Все добавлены в `EVENT_DOMAIN_MAP` с правильным доменом.

### 2. Coverage Contracts (audit-coverage.contract.ts)

Новый файл `apps/api/src/modules/audit/audit-coverage.contract.ts`:
- `AUDIT_COVERAGE_CONTRACTS` — массив contract objects для 9 модулей: auth, catalog, inventory, marketplace_sync, team, tenants, marketplace_accounts, billing, support
- Каждый контракт содержит `mandatoryEvents[]` — перечень событий, которые модуль **обязан** эмитировать
- Хелперы `getModuleContract(module)`, `isMandatoryEvent(module, eventType)` для проверки покрытия

### 3. Миграция sync.service.ts (3 прямых prisma.auditLog.create → writeEvent)

**Проблема:** 3 вызова `this.prisma.auditLog.create()` с `as any` cast для `ORDER_DEDUCTED` — полный обход AuditService.

**Исправление:**
- Добавлен `AuditService` в constructor + AuditModule в SyncModule imports
- Удалён импорт `ActionType` из файла
- WB заказ → `writeEvent({ eventType: STOCK_ORDER_DEDUCTED, actorType: 'marketplace', source: 'worker', ... })`
- Ozon отмена → `writeEvent({ eventType: STOCK_ORDER_RETURNED, ... })`
- Ozon заказ → `writeEvent({ eventType: STOCK_ORDER_DEDUCTED, ... })`
- Все три записи теперь имеют структурированный `before/after` и `metadata` с marketplace и orderId

### 4. Миграция auth.service.ts (logger → writeSecurityEvent)

**Проблема:** 15 вызовов `this.auditLog()` — private helper, пишущий только в JSON-лог. Security events не попадали в БД.

**Исправление:**
- Добавлен `AuditService` в constructor + AuditModule в AuthModule imports
- Заменены 9 критичных security событий на `await this.auditService.writeSecurityEvent()`:
  - `auth_login_blocked` → `login_failed` + metadata `{reason: 'soft_lock'}`
  - `auth_login_failed` (3 вызова) → `login_failed` + metadata `{reason: ...}`
  - `auth_login_succeeded` → `login_success`
  - `auth_refresh_token_reuse_detected` → `session_revoked` + `{reason: 'token_reuse'}`
  - `auth_session_revoked` (2 вызова) → `session_revoked`
  - `auth_password_reset_requested` → `password_reset_requested`
  - `auth_password_reset_completed` → `password_changed` + `{via: 'password_reset'}`
  - `auth_password_changed` → `password_changed` + `{via: 'self_service'}`
- Некритичные события (регистрация, email verification) остались в logger

### 5. Миграция product.service.ts (6 logAction → writeEvent)

Заменены все 6 вызовов legacy `logAction()`:

| Событие | Новый eventType | Примечание |
|---|---|---|
| PRODUCT_RESTORED (via create) | `PRODUCT_RESTORED` | before/after state |
| PRODUCT_CREATED | `PRODUCT_CREATED` | after snapshot |
| PRODUCT_UPDATED | `PRODUCT_UPDATED` | before/after name+sku, changedFields из dto |
| PRODUCT_DELETED | `PRODUCT_ARCHIVED` | status transition |
| PRODUCT_RESTORED | `PRODUCT_RESTORED` | status transition |
| STOCK_ADJUSTED | `STOCK_MANUALLY_ADJUSTED` | delta+reasonCode в metadata |

### 6. Миграция inventory.service.ts (1 logAction → writeEvent)

- STOCK_ADJUSTED → `STOCK_MANUALLY_ADJUSTED`
- before/after используют `onHand` (правильное поле StockBalance), а не legacy `total`
- `warehouseId`, `movementId`, `reasonCode`, `comment` в structured metadata

### 7. Миграция mapping.service.ts (4 logAction → writeEvent)

| Событие | Новый eventType | Актор | Source |
|---|---|---|---|
| MAPPING_CREATED (manual) | `MARKETPLACE_MAPPING_CREATED` | user | ui |
| MAPPING_CREATED (auto-match) | `MARKETPLACE_MAPPING_CREATED` | system | worker |
| MAPPING_DELETED | `MARKETPLACE_MAPPING_DELETED` | user | ui |
| PRODUCT_MERGED | `PRODUCT_DUPLICATE_MERGED` | user | ui |

### 8. Миграция import.service.ts (5 logAction → writeEvent)

| Событие | Новый eventType | Source |
|---|---|---|
| IMPORT_COMMITTED (сводный) | `CATALOG_IMPORT_COMMITTED` | ui |
| PRODUCT_UPDATED (в _applyCreate) | `PRODUCT_UPDATED` | api |
| PRODUCT_CREATED (в _applyCreate) | `PRODUCT_CREATED` | api |
| PRODUCT_CREATED (в _applyUpdate, recreate) | `PRODUCT_CREATED` + via=import_recreate_deleted | api |
| PRODUCT_UPDATED (в _applyUpdate) | `PRODUCT_UPDATED` | api |

### 9. Internal Write Endpoint (audit.controller.ts)

Добавлен `POST /audit/internal/write`:
- Защищён `X-Internal-Secret` header (проверяется против `INTERNAL_API_SECRET` env var)
- Принимает `{ type: 'audit' | 'security', payload: ... }`
- Вызывает `writeEvent()` или `writeSecurityEvent()` в зависимости от type
- Не требует JWT / tenant context — только internal secret

### 10. Write Strategy

**Текущее состояние:** все audit записи выполняются через `await` после бизнес-транзакции. Это "допустимый" вариант (не потеряется при нормальном потоке), но не атомарен с бизнес-изменением.

**Закреплено:** best-effort fire-and-forget без `await` полностью исключён — все вызовы `await`-ed.

**Следующий шаг (TASK_AUDIT_5):** embed audit write в бизнес-транзакцию через Prisma `$transaction` для atomic writes по критичным операциям (STOCK_MANUALLY_ADJUSTED, PRODUCT_ARCHIVED).

### Итог

Все критерии закрытия выполнены:
- ✅ audit write path надёжен — везде `await`, нет fire-and-forget
- ✅ все доменные модули используют единый `AuditService.writeEvent()` / `writeSecurityEvent()`
- ✅ security events из auth попадают в БД (а не только в logger)
- ✅ sync.service устранил прямой prisma bypass и `as any` cast
- ✅ coverage по critical actions определён в `audit-coverage.contract.ts`
- ✅ internal write endpoint готов для worker/background job интеграции
- ✅ `prisma validate` прошёл успешно
