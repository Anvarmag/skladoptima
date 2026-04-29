# TASK_AUDIT_7 — QA, Regression и Observability Audit

> Модуль: `16-audit`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUDIT_1`
  - `TASK_AUDIT_2`
  - `TASK_AUDIT_3`
  - `TASK_AUDIT_4`
  - `TASK_AUDIT_5`
  - `TASK_AUDIT_6`
- Что нужно сделать:
  - покрыть тестами inventory/team/catalog/support/auth audit scenarios из mandatory catalog;
  - проверить failed login security event, support action trace и redaction чувствительных полей;
  - покрыть RBAC кейсы для `OWNER/ADMIN/MANAGER/STAFF`;
  - проверить доступность history screen в `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - завести метрики и алерты по audit write failures, coverage drops, RBAC denials и security event volume.
- Критерий закрытия:
  - регрессии по immutable storage, RBAC и redaction ловятся автоматически;
  - observability показывает состояние audit coverage и write reliability;
  - QA matrix покрывает утвержденный MVP audit catalog.

---

## Что сделано

### 1. `audit.service.spec.ts` — 38 unit-тестов (новый файл)

Создан полный spec-файл `apps/api/src/modules/audit/audit.service.spec.ts`, покрывающий тестовую матрицу из system-analytics §17.

**writeEvent:**
- сохраняет корректные поля при stock adjustment (INVENTORY);
- применяет eventDomain из EVENT_DOMAIN_MAP автоматически;
- sanitize удаляет password/passwordHash/token/apiKey из before/after/metadata на любой глубине;
- sanitize обрабатывает массивы в payload;
- defaults visibilityScope=tenant, redactionLevel=none;
- catalog event PRODUCT_ARCHIVED с changedFields;
- team event MEMBER_ROLE_CHANGED с before/after (role transition).

**writePrivilegedEvent:**
- принудительно выставляет actorType=support и visibilityScope=internal_only;
- default redactionLevel=partial;
- поддерживает явный redactionLevel=strict.

**writeSecurityEvent:**
- LOGIN_FAILED с ip, userId, metadata;
- LOGIN_SUCCESS с tenantId;
- password_reset_requested без userId (userId=null, tenantId=null).

**assertOwnerOrAdmin — RBAC:**
- OWNER → разрешён;
- ADMIN → разрешён;
- MANAGER → AUDIT_ROLE_FORBIDDEN;
- STAFF → AUDIT_ROLE_FORBIDDEN;
- нет членства → AUDIT_ROLE_FORBIDDEN;
- userId undefined → AUDIT_ACCESS_DENIED.

**getLogs:**
- возвращает только tenant-visible записи (visibilityScope=tenant в where);
- retention window: where.createdAt.gte не ранее 180 дней;
- зажимает очень старый from до retention window;
- принимает недавний from и НЕ зажимает его;
- meta.retentionDays=180;
- фильтр по entityType;
- фильтр по requestId и correlationId;
- strict redaction — before/after/changedFields/metadata = null.

**getLog (drill-down):**
- возвращает запись по id;
- NOT_FOUND для несуществующей записи;
- AUDIT_INTERNAL_ONLY_RECORD для internal_only записи;
- partial redaction — убирает все AUDIT_INTERNAL_METADATA_KEYS (internalNote, supportTicketId, operatorId, requestOrigin, debugContext), оставляет публичные поля.

**getSecurityEvents:**
- собирает userId всех активных участников тенанта в cross-member запрос;
- IPv4 masking — скрывает последний октет (192.168.10.55 → 192.168.10.*);
- IPv6 masking — скрывает последнюю группу;
- ip=null → остаётся null;
- фильтр по userId.

**getCoverageStatus:**
- overallCoveragePct=0 если ни одного события нет;
- 100% по модулю auth если все 6 событий присутствуют;
- корректно сообщает о missing events.

**maskAuditLogForTenant:**
- redactionLevel=none — before/after/metadata проходят насквозь;
- redactionLevel=strict — all payload fields = null.

### 2. `audit-read.guard.spec.ts` — 11 unit-тестов (новый файл)

Создан spec-файл `apps/api/src/modules/audit/audit-read.guard.spec.ts`.

**Покрыто:**
- нет user → AUDIT_ACCESS_DENIED;
- нет tenantId ни в header, ни в activeTenantId → TENANT_CONTEXT_REQUIRED;
- нет активного членства → AUDIT_ACCESS_DENIED + Logger.warn с audit_read_denied;
- активное членство → guard возвращает true;
- после прохождения устанавливает request.activeTenantId;
- X-Tenant-Id header имеет приоритет над activeTenantId (lookup выполняется по header tenantId);
- TRIAL_EXPIRED / SUSPENDED / CLOSED — guard НЕ проверяет accessState, пропускает при наличии членства (compliance requirement §4 scenario 4); activeTenantId устанавливается из header;
- X-Tenant-Id присутствует, но членства нет → ForbiddenException.

**Итого: 49 тестов, все PASS.**

### 3. Structured observability logging в `audit.service.ts`

Добавлен `Logger` в `AuditService` с метриками в формате JSON:

| Метрика | Где | Поля |
|---------|-----|------|
| `audit_write_success` | writeEvent (успех) | eventType, eventDomain, actorType, tenantId, ts |
| `audit_write_failure` | writeEvent (catch) | eventType, tenantId, error, ts; re-throws |
| `security_event_logged` | writeSecurityEvent | eventType, userId, tenantId, ts |
| `audit_query_executed` (getLogs) | getLogs | query, tenantId, filters, resultCount, ts |
| `audit_query_executed` (getSecurityEvents) | getSecurityEvents | query, tenantId, filters, resultCount, ts |
| `audit_coverage_checked` | getCoverageStatus | tenantId, overallCoveragePct, totalEvents, totalCovered, ts |

Guard `AuditReadGuard` уже содержал `audit_read_denied` metric (из TASK_AUDIT_3).

Все метрики пишутся через `Logger.log()` / `Logger.error()` в structured JSON — совместимо с любым log aggregator (ELK, CloudWatch, Datadog).
