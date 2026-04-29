# TASK_ADMIN_4 — Internal Notes, Support Actions Log и Audit Integration

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_ADMIN_2`
  - `TASK_ADMIN_3`
  - согласован `16-audit`
- Что нужно сделать:
  - завести `support_actions` и `support_notes`;
  - реализовать `GET/POST /api/v1/admin/tenants/:tenantId/notes`;
  - сохранять `reason`, `payload`, `result_status`, `audit_log_id`, `correlation_id` для support actions;
  - позволить `SUPPORT_READONLY` видеть internal notes только в read-only модели;
  - связать notes/actions с общим audit trail.
- Критерий закрытия:
  - internal notes и support actions пригодны для handoff и расследований;
  - mutating и read-only support traces различимы;
  - audit linkage присутствует для всех high-risk действий.

**Что сделано**

T3 уже принёс таблицы `support_actions`/`support_notes`, endpoints `GET/POST /api/admin/tenants/:tenantId/notes`, базовый `SupportActionsService` и `support_actions` запись для каждого mutating действия. T4 закрывает три оставшихся пробела из критерия закрытия: `audit_log_id` всегда был NULL, `correlation_id` никогда не доезжал из request, а notes не попадали в общий audit trail (только в admin-журнал).

### 1. AuditLog ↔ support_actions linkage

**До T4:** `support-actions.service.ts` явно передавал `auditLogId: null` во всех ветках — `writePrivilegedEvent` возвращал `Promise<void>`, поэтому id создаваемой записи не был доступен. По требованию аналитики «audit linkage присутствует для всех high-risk действий» это пробел.

**Изменения:**

- [audit.service.ts:63](apps/api/src/modules/audit/audit.service.ts#L63) — `writeEvent` теперь возвращает `Promise<string>` (id созданной AuditLog записи) через `select: { id: true }`. Все остальные callers (`team`, `catalog`, `inventory`, `marketplace_sync`, `files`, `stock-locks`, `import`, `mapping`, `audit.controller`) await'ят его без обработки return value, поэтому изменение контракта обратно-совместимо.
- [audit.service.ts:128](apps/api/src/modules/audit/audit.service.ts#L128) — `writePrivilegedEvent` тоже возвращает `Promise<string>`. Это единственный callsite, которому id реально нужен (admin-плоскость).
- [support-actions.service.ts:386](apps/api/src/modules/admin/support-actions/support-actions.service.ts#L386) — добавлен private helper `safeWriteAudit()`: обёртка над `writePrivilegedEvent`, которая никогда не валит support action. Если AuditLog write упал, `support_actions` всё равно сохраняется с `auditLogId = null` — admin-журнал не теряется из-за проблем общего audit trail (тот же подход, что и `recordAction` в T3).
- В трёх mutating путях — `runTenantAction` (`extend-trial` / `set-access-state` / `restore-tenant`), `triggerPasswordReset`, `recordNoteAdded` — id, возвращённый `safeWriteAudit`, теперь сохраняется в `support_actions.audit_log_id`. После T4 каждое успешное mutating support действие имеет связь admin-журнал → tenant-facing AuditLog → security event (через requestId/correlationId).

### 2. correlation_id end-to-end

**До T4:** поле `correlationId` существовало в схеме `support_actions` (T3 миграция), но ни один путь не извлекал его из request и не передавал в context — поле было мёртвое.

**Изменения:**

- Новый файл [admin-request-context.ts](apps/api/src/modules/admin/admin-auth/admin-request-context.ts) — единая точка чтения transport-уровневого контекста support-запроса:
  - `extractCorrelationId(req)` читает `x-correlation-id` (основной) с fallback на `x-request-id` (стандарт reverse-proxy);
  - валидация через `^[A-Za-z0-9._-]{1,128}$` — отсекает мусор, мульти-значения и попытки прокинуть log-injection полезную нагрузку (защита перед попаданием в audit trail и логи);
  - `buildSupportRequestContext(req)` собирает `{ ip, userAgent, correlationId }` единым объектом.
- Все три admin-controller'а ([support-tenant-actions.controller.ts](apps/api/src/modules/admin/support-actions/support-tenant-actions.controller.ts), [support-user-actions.controller.ts](apps/api/src/modules/admin/support-actions/support-user-actions.controller.ts), [support-notes.controller.ts](apps/api/src/modules/admin/support-notes/support-notes.controller.ts)) переведены на `buildSupportRequestContext(req)`. Дублирующиеся `ip()` / `ua()` методы удалены.
- `ActionContext` в [support-actions.service.ts:14-22](apps/api/src/modules/admin/support-actions/support-actions.service.ts#L14-L22) расширен полем `correlationId: string | null`. Поле сохраняется и в `support_actions.correlation_id`, и пробрасывается в `writePrivilegedEvent` — поэтому `AuditLog.correlationId` для всех privileged write'ов теперь несёт тот же корреляционный id. На разборе инцидента это даёт сквозную связь admin-плоскость ↔ общий audit trail.

### 3. Notes → общий audit trail

**До T4:** `recordNoteAdded` писал только в `support_actions` (action_type=`ADD_INTERNAL_NOTE`). По требованию T4 «связать notes/actions с общим audit trail» note creation тоже должен попадать в AuditLog.

**Изменения:**

- В [audit-event-catalog.ts:91](apps/api/src/modules/audit/audit-event-catalog.ts#L91) добавлен event `SUPPORT_NOTE_ADDED` с domain `SUPPORT`. Соответствующее поле добавлено в `EVENT_DOMAIN_MAP`, чтобы `writeEvent` корректно выводил domain без явного указания.
- В [audit-coverage.contract.ts:110](apps/api/src/modules/audit/audit-coverage.contract.ts#L110) `SUPPORT_NOTE_ADDED` включён в `mandatoryEvents` контракта `support`, чтобы `getCoverageStatus` учитывал его при проверке покрытия модуля.
- [support-actions.service.ts:236-272](apps/api/src/modules/admin/support-actions/support-actions.service.ts#L236-L272) — `recordNoteAdded` теперь вызывает `safeWriteAudit({ eventType: SUPPORT_NOTE_ADDED, entityType: 'support_note', entityId: noteId, … })` ПЕРЕД записью в `support_actions`, и сохраняет полученный id в `audit_log_id`. Метод теперь возвращает `{ auditLogId }` вместо `void`.
- [support-notes.service.ts:80-90](apps/api/src/modules/admin/support-notes/support-notes.service.ts#L80-L90) — `create()` принимает полный `SupportRequestContext` (с correlation_id), пробрасывает в `recordNoteAdded`, и возвращает `auditLogId` в ответе POST `/notes`. Это даёт UI возможность сразу показать ссылку на audit-запись для новой ноты.

### 4. SUPPORT_READONLY read-only invariant

Read-only доступ к notes уже корректно реализован в T3 (class-default = обе роли, POST имеет method-level `@AdminRoles('SUPPORT_ADMIN')` через `getAllAndOverride`). T4 этот контракт не меняет, но фиксирует его: ответ `GET /notes` отдаёт только `{ id, note, createdAt, updatedAt, author{id,email,role} }` — без IP/user-agent оператора, без correlation-id и без support-action журнала. SUPPORT_READONLY видит «что было замечено по тенанту», но не наблюдает за коллегами-операторами.

### 5. Внесение reason в metadata audit-event

Раньше `reason` фиксировался только в `support_actions.reason`. T4 добавляет дублирование в `AuditLog.metadata.reason` для tenant-state actions (`runTenantAction` теперь сливает `{ ...result.audit.metadata, reason }`) и для password-reset (`metadata: { supportAction, reason }`). Это даёт OWNER/ADMIN tenant'а возможность через tenant-facing audit API увидеть, по какой причине support менял состояние, не запрашивая admin-журнал отдельно (в рамках `internal_only` visibility — только во внутреннем review-flow).

### 6. Тесты

- В [audit.service.spec.ts](apps/api/src/modules/audit/audit.service.spec.ts) добавлены два новых теста для блока `writePrivilegedEvent`:
  1. `возвращает id созданной audit-записи (TASK_ADMIN_4: linkage support_actions.audit_log_id)` — верифицирует новый return-контракт;
  2. `пробрасывает correlationId в AuditLog (TASK_ADMIN_4: cross-trail link)` — гарантирует, что correlation_id из admin-плоскости не теряется при записи в общий audit trail.
- Все 43 существующих теста audit-сервиса проходят. Изменение контракта `writeEvent` от `Promise<void>` на `Promise<string>` обратно-совместимо: ни один существующий caller не использует return value.

### 7. Проверки

- `npx tsc --noEmit | grep -E "admin|audit\.service|support-"` — пусто (admin/audit модули чистые).
- `npx jest src/modules/audit/audit.service.spec.ts` — 43/43 passed (включая 2 новых для T4).
- Оставшиеся TS-ошибки репозитория (catalog/import, inventory, sync-runs, fix-ozon-dates, test-fbo) — pre-existing и не связаны с T4 (зафиксировано ещё в TASK_ADMIN_3 §9).

### 8. Что НЕ сделано в этой задаче (по плану)

- frontend admin UI для notes/handoff — TASK_ADMIN_5/6;
- security review observability и алертов на high-risk действия — TASK_ADMIN_7;
- персистентный FK `support_actions.audit_log_id → audit_logs.id` — оставлен plain string'ом сознательно (audit_log может уехать в long-term storage / partition'ы, FK ограничит lifecycle); инвариант «id корректен» обеспечивается тем, что значение приходит из того же транзакционного контекста, что и его источник.
