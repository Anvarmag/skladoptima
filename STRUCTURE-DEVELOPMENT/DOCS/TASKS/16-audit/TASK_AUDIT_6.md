# TASK_AUDIT_6 — Frontend History, Detail Drill-Down и Investigation UX

> Модуль: `16-audit`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_AUDIT_4`
  - `TASK_AUDIT_5`
- Что нужно сделать:
  - доработать `/app/history` фильтрами, detail view и before/after diff;
  - показывать actor, domain, entity, request/correlation context и changed fields;
  - скрывать security/internal-only детали по RBAC;
  - оставить экран доступным только `OWNER/ADMIN`;
  - поддержать read-only UX в `TRIAL_EXPIRED / SUSPENDED / CLOSED`.
- Критерий закрытия:
  - пользователь быстро понимает кто, что и когда изменил;
  - drill-down достаточен для product/support расследований;
  - UI не раскрывает internal-only или чувствительные поля.

**Что сделано**

### `apps/web/src/api/audit.ts` — новый API-клиент (создан с нуля)

Типизированный модуль для работы с audit API:
- `AuditLog` — полный тип записи (canonical + legacy поля)
- `SecurityEvent` — тип security event
- `auditApi.getLogs(tenantId, filters)` — GET /audit/logs с полным набором фильтров
- `auditApi.getLog(tenantId, id)` — GET /audit/logs/:id
- `auditApi.getSecurityEvents(tenantId, filters)` — GET /audit/security-events
- Все запросы передают `X-Tenant-Id` заголовок (через хелпер `tenantHeaders()`), что обеспечивает работу при TRIAL_EXPIRED/SUSPENDED/CLOSED

### `apps/web/src/pages/History.tsx` — полная переработка

**Было**: legacy страница с прямым axios.get на `/audit`, только 4 типа событий, только продуктовые поля, нет drill-down.

**Стало**:

#### Два таба
- **Журнал** — аудит бизнес-событий (`/audit/logs`)
- **Security** — события безопасности (`/audit/security-events`)

#### Фильтры (журнал)
- Домен (select с 11 доменами + русские лейблы)
- Тип сущности (text input)
- Дата от / до (date inputs)
- Кнопка «Сбросить фильтры», счётчик активных фильтров
- Collapsible панель — не занимает место по умолчанию

#### Таблица журнала
- Время, Домен (цветной badge), Событие (Russian label), Сущность (type + truncated ID), Исполнитель (actor type)
- Строки кликабельны → открывают detail panel
- Backward-compatible: legacy записи без `eventType` отображаются через `actionType`

#### Detail Panel (side sheet)
- Открывается поверх контента с backdrop overlay
- Секция «Контекст»: domain, entityType, entityId, actorType+role, source, время с секундами
- Секция «Трассировка»: requestId, correlationId (для correlation с логами)
- Секция «Изменения»:
  - `redactionLevel=strict` → «Детали скрыты политикой редактирования»
  - changedFields → цветные теги полей
  - `DiffView` — for/after diff: old value зачёркнут красным, new value зелёным, изменившиеся поля на amber фоне
- Секция legacy (для старых записей): SKU, beforeTotal/afterTotal/delta, note
- Секция «Метаданные» (если есть)

#### Security events таб
- Фильтр по типу события
- Таблица: время, badge события (красный для login_failed, зелёный для login_success), userId (truncated), IP (masked сервером), User-Agent

#### Read-only баннер
- При `TRIAL_EXPIRED / SUSPENDED / CLOSED` — amber warning banner с соответствующим сообщением

#### Хедер с retention hint
- Показывает «Хранится 180 дней» из `meta.retentionDays`

#### Прочее
- Пагинация с счётчиком «(N записей)»
- Debounce 200ms при загрузке
- Сброс страницы при изменении фильтров
- Полная типобезопасность TypeScript
