# TASK_CATALOG_4 — Auto/Manual Mappings и Duplicate Merge

> Модуль: `05-catalog`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_CATALOG_1`
  - `TASK_CATALOG_3`
  - согласованы `08-marketplace-accounts` и `09-sync`
- Что нужно сделать:
  - реализовать auto-match по SKU и manual mapping для unmatched external items;
  - реализовать `GET unmatched` и `POST manual mapping`;
  - добавить ручной merge дублей как дополнительный MVP-сценарий;
  - не позволять sync/import бесконтрольно перепривязывать mapping;
  - писать mapping/merge изменения в audit.
- Критерий закрытия:
  - unmatched товары видны и могут быть вручную связаны;
  - duplicate merge поддержан как отдельный управляемый сценарий;
  - mappings остаются консистентны между импортом, sync и orders/stocks flow.

**Что сделано**

Реализованы auto/manual mappings и duplicate merge для каталога. Изменения в схеме минимальны — добавлены три новых значения `ActionType` для аудита.

### Миграция

**`apps/api/prisma/migrations/20260426070000_catalog_mapping_merge/migration.sql`**
- `ALTER TYPE "ActionType" ADD VALUE 'MAPPING_CREATED'`
- `ALTER TYPE "ActionType" ADD VALUE 'MAPPING_DELETED'`
- `ALTER TYPE "ActionType" ADD VALUE 'PRODUCT_MERGED'`

### Schema

**`apps/api/prisma/schema.prisma`** — добавлены три значения в enum `ActionType`.

### Новые DTO

**`dto/manual-mapping.dto.ts`** — `{ productId, marketplace, externalProductId, externalSku? }`.

**`dto/auto-match.dto.ts`** — `{ marketplace, externalProductId, externalSku, externalName? }`.

**`dto/merge-products.dto.ts`** — `{ sourceProductId, targetProductId }`.

### `mapping.service.ts`

- **`getUnmatched`** — возвращает активные товары tenant без channel-маппинга ни в одном канале. Опциональный фильтр по `marketplace`. Реализован через set-разницу: все `productId`-ы с маппингами вычитаются из активных товаров.

- **`getMappings`** — список всех маппингов с join на `product` (sku, name, brand). Фильтр по `marketplace` и пагинация.

- **`createManual`** — ручной маппинг `productId ↔ externalProductId`. Проверяет: (1) товар существует и активен в tenant; (2) маппинг с таким `externalProductId` не существует — если существует, бросает `409 MAPPING_ALREADY_EXISTS` с `existingMappingId` и `existingProductId`, чтобы пользователь мог явно удалить старый маппинг и перепривязать. Это реализует требование «не позволять бесконтрольную перепривязку».

- **`autoMatch`** — автосопоставление внешнего item по `externalSku → internal sku`. Идемпотентен: если маппинг уже есть — возвращает его с `alreadyExisted=true`. Если внутренний товар не найден — `matched=false` без ошибки. Создаёт маппинг с `isAutoMatched=true`.

- **`deleteMapping`** — удалить маппинг по id с проверкой принадлежности tenant. Единственный способ сделать `externalProductId` снова доступным для перепривязки.

- **`mergeProducts`** — слияние дублей: переносит маппинги из `source` в `target`, пропуская конфликтующие (возникают если у target уже есть маппинг на тот же marketplace+externalProductId). Soft-delete source. Возвращает статистику `{ mappingsTransferred, mappingsSkipped }`. Аудит с описанием откуда и что перенесено.

### `mapping.controller.ts` (`@Controller('catalog/mappings')`)

| Метод | Путь | Guard | Назначение |
|-------|------|-------|------------|
| `GET` | `/catalog/mappings/unmatched` | RequireActiveTenant | Товары без маппинга |
| `GET` | `/catalog/mappings` | RequireActiveTenant | Все маппинги |
| `POST` | `/catalog/mappings/manual` | TenantWrite | Ручной маппинг |
| `POST` | `/catalog/mappings/auto-match` | TenantWrite | Авто-match по SKU |
| `POST` | `/catalog/mappings/merge` | TenantWrite | Merge дублей |
| `DELETE` | `/catalog/mappings/:id` | TenantWrite | Удалить маппинг |

### `product.module.ts`

Добавлены `MappingService` в `providers` и `MappingController` в `controllers`.

### Ключевые свойства

- **Защита от перепривязки**: уникальное ограничение `(tenantId, marketplace, externalProductId)` + явная бизнес-ошибка `MAPPING_ALREADY_EXISTS` с деталями существующего маппинга.
- **Идемпотентный auto-match**: повторный вызов не создаёт дублей маппингов.
- **Безопасный merge**: конфликты маппингов пропускаются (не теряются), статистика возвращается в ответе.
- **Полный аудит**: все события (`MAPPING_CREATED`, `MAPPING_DELETED`, `PRODUCT_MERGED`) пишутся в `AuditLog` с деталями в поле `note`.
