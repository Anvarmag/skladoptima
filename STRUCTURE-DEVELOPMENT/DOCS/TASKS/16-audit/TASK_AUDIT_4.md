# TASK_AUDIT_4 — Read API, RBAC Filters и Tenant/Internal Visibility Scopes

> Модуль: `16-audit`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_AUDIT_1`
  - `TASK_AUDIT_2`
  - `TASK_AUDIT_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/audit/logs`, `GET /api/v1/audit/logs/:id`, `GET /api/v1/audit/security-events`, `GET /api/v1/audit/coverage-status`;
  - применить RBAC filters: в MVP tenant-facing audit доступен только `OWNER` и `ADMIN`;
  - не отдавать `internal_only` записи в tenant-facing API;
  - обеспечить фильтрацию по tenant/entity/actor/time/request/correlation;
  - поддержать history read-only доступ в `TRIAL_EXPIRED / SUSPENDED / CLOSED`.
- Критерий закрытия:
  - audit read API пригоден для расследований и drill-down;
  - RBAC и visibility scope соблюдаются последовательно;
  - paused tenant не теряет историческое чтение при валидной сессии и допущенной роли.

**Что сделано**

### AuditReadGuard (`audit-read.guard.ts`)

Создан отдельный guard для всех read-эндпоинтов аудита. Ключевое отличие от `RequireActiveTenantGuard`: guard **не проверяет статус тенанта** — только наличие ACTIVE membership пользователя. Это позволяет читать историю аудита даже при `TRIAL_EXPIRED / SUSPENDED / CLOSED`.

Алгоритм определения tenantId:
1. `X-Tenant-Id` header (обязателен для закрытых тенантов, где `activeTenantId = null`)
2. `request.activeTenantId` (устанавливается глобальным `ActiveTenantGuard` для активных тенантов)

После проверки guard **переопределяет** `request.activeTenantId`, что позволяет последующему `assertOwnerOrAdmin()` работать корректно даже в случае закрытого тенанта.

### `GET /audit/logs` — расширены query-фильтры

Добавлены фильтры для drill-down расследований:
- `entityId` — конкретный ID сущности (товар, склад и т.д.)
- `requestId` — UUID запроса (для корреляции с логами)
- `correlationId` — UUID корреляции (для связки нескольких событий)
- `from` / `to` — временной диапазон (ISO datetime)

### `GET /audit/logs/:id` — детальный просмотр записи

Новый эндпоинт для drill-down. Возвращает полную запись с before/after payload. Проверяет:
- `tenantId` совпадает с activeTenantId запроса
- `visibilityScope !== internal_only` — internal_only записи никогда не отдаются в tenant-facing API (бросает `AUDIT_INTERNAL_ONLY_RECORD`)

### `GET /audit/security-events` — расширены фильтры

Добавлены: `userId` (фильтр по конкретному участнику), `from` / `to` (временной диапазон).

### `GET /audit/coverage-status` — диагностика покрытия

Новый диагностический эндпоинт. Для каждого модуля из `AUDIT_COVERAGE_CONTRACTS` возвращает:
- `covered` — события, зафиксированные хотя бы раз для тенанта (с `lastSeenAt`)
- `missing` — mandatory events которые ни разу не появлялись
- `coveragePct` — процент покрытия
- `overallCoveragePct` — суммарный процент по всем модулям

Реализован одним батчевым запросом к БД (`findMany` с `distinct: ['eventType']`), без N+1.

### Файлы изменений

- `apps/api/src/modules/audit/audit-read.guard.ts` — создан (новый)
- `apps/api/src/modules/audit/audit.service.ts` — расширены `AuditLogFilters`, `SecurityEventFilters`, `getLogs()`, `getSecurityEvents()`; добавлены `getLog()`, `getCoverageStatus()`
- `apps/api/src/modules/audit/audit.controller.ts` — заменён guard, добавлены эндпоинты `/logs/:id` и `/coverage-status`, расширены query параметры
- `apps/api/src/modules/audit/audit.module.ts` — добавлен `AuditReadGuard` в providers
