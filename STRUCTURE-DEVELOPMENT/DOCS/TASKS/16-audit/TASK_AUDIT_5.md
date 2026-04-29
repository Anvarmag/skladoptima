# TASK_AUDIT_5 — Before/After Policy, Redaction/Masking и Retention Rules

> Модуль: `16-audit`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_AUDIT_1`
  - `TASK_AUDIT_3`
  - `TASK_AUDIT_4`
- Что нужно сделать:
  - закрепить policy `summary diff + safe key fields` по умолчанию;
  - допускать полные `before/after` только для малых и безопасных сущностей;
  - исключить из payload чувствительные поля: `password`, `token`, `secret`, `apiKey`, `refreshToken`, verification tokens;
  - реализовать redaction/masking по RBAC для tenant-facing read model;
  - зафиксировать tenant-facing retention window = `180 дней`, без cold storage в MVP.
- Критерий закрытия:
  - sensitive values не попадают в audit trail и tenant UI;
  - before/after policy воспроизводима и не раздувает рискованные payload;
  - retention и masking semantics однозначны для MVP.

**Что сделано**

### Deep sanitization (`audit.service.ts`)

Метод `sanitize()` переработан с shallow на **рекурсивный**: теперь обрабатывает вложенные объекты и массивы на любой глубине. Сигнатура изменена с `Record<string,unknown>` на `unknown` — метод безопасно обходит primitive, array и object значения.

Также `metadata` теперь тоже прогоняется через `sanitize()` при записи (`writeEvent()`). Ранее metadata писалась raw, что позволяло случайно включить в неё чувствительные поля.

В `SENSITIVE_AUDIT_FIELDS` добавлены `privateKey` и `clientSecret`.

### Retention window — 180 дней (`getLogs()`)

Добавлена константа `AUDIT_RETENTION_DAYS = 180` в `audit-event-catalog.ts`. В `getLogs()` автоматически вычисляется `retentionCutoff = now - 180 days`. Если клиент не передаёт `from` — используется cutoff. Если передаёт `from` старше cutoff — silently clamp до cutoff. Таким образом, tenant-facing API никогда не вернёт записи старше 180 дней. В `meta` ответа добавлено поле `retentionDays: 180` для явного информирования клиента.

### RBAC masking по `redactionLevel` (`maskAuditLogForTenant()`)

Новый приватный метод применяется ко всем записям перед отдачей через `getLogs()` и `getLog()`:

- `redactionLevel === strict` → `before`, `after`, `changedFields`, `metadata` обнуляются
- `redactionLevel === partial` → из `metadata` вырезаются internal-ключи (`internalNote`, `supportTicketId`, `operatorId`, `requestOrigin`, `debugContext`)
- `redactionLevel === none` → возвращается как есть (sensitive поля уже удалены при записи)

Набор internal-ключей вынесен в константу `AUDIT_INTERNAL_METADATA_KEYS` в `audit-event-catalog.ts`.

### IP masking в security events (`maskIpForTenant()`)

Новый приватный метод маскирует последний октет IPv4 (`192.168.1.100` → `192.168.1.*`) и последний группу IPv6 (`2001:db8:....:1234` → `2001:db8::****`). Применяется ко всем IP в `getSecurityEvents()` перед ответом. Полные IP-адреса остаются только в БД и доступны support/internal инструментам.

### Файлы изменений

- `apps/api/src/modules/audit/audit-event-catalog.ts` — добавлены `AUDIT_RETENTION_DAYS`, `AUDIT_INTERNAL_METADATA_KEYS`, расширен `SENSITIVE_AUDIT_FIELDS`
- `apps/api/src/modules/audit/audit.service.ts` — рекурсивный `sanitize()`, sanitize metadata в `writeEvent()`, retention window в `getLogs()`, `maskAuditLogForTenant()`, IP masking в `getSecurityEvents()`
