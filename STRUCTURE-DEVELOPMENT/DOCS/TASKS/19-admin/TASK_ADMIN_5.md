# TASK_ADMIN_5 — Security Guardrails, Forbidden Actions и Support Role Separation

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ADMIN_1`
  - `TASK_ADMIN_3`
  - `TASK_ADMIN_4`
  - согласованы `13-billing`, `16-audit`
- Что нужно сделать:
  - запретить `special access / billing override` в MVP;
  - запретить impersonation/login-as-user и доступ к plaintext credentials/passwords;
  - ограничить `SUPPORT_READONLY` только read scenarios;
  - enforce-ить обязательный `reason` и отдельный support audit context для high-risk actions;
  - валидировать `restore-tenant` только для `CLOSED` tenant внутри retention window.
- Критерий закрытия:
  - support контур не создает скрытых override-механик;
  - опасные forbidden actions технически закрыты;
  - разделение `SUPPORT_ADMIN` и `SUPPORT_READONLY` устойчиво и прозрачно.

**Что сделано**

Аудит существующего кода (после T1–T4) показал, что большинство guardrail'ов уже стояло, но был один **критичный billing-override gap** в `AccessStatePolicy.assertSupportTransitionAllowed` и не был закрыт fail-fast в DTO. T5 закрывает оставшиеся пробелы.

### 1. Закрыт billing-override gap в `AccessStatePolicy`

[apps/api/src/modules/tenants/access-state.policy.ts](apps/api/src/modules/tenants/access-state.policy.ts)

До T5 `assertSupportTransitionAllowed(from, to)` объединял стандартные `ALLOWED_TRANSITIONS[from]` с `SUPPORT_ALLOWED_TRANSITIONS[from]`:

```ts
const allowed = [...standard, ...supportExtra];
```

Это означало, что SUPPORT_ADMIN мог через `POST /api/admin/tenants/:id/actions/set-access-state` выполнять «обычные» tenant-переходы — в том числе:

- `SUSPENDED → ACTIVE_PAID` (вернуть платный доступ заблокированному tenant'у),
- `TRIAL_ACTIVE → ACTIVE_PAID` (выдать платный план активному триалу),
- `GRACE_PERIOD → ACTIVE_PAID` (зафиксировать оплату вручную).

Каждый такой переход = hidden billing override без записи в биллинговом контуре, что прямо запрещено §15 («SUPPORT_ADMIN не может выдавать hidden billing overrides») и §22 («special access / billing override не входят в MVP»).

**Исправление:**

- `assertSupportTransitionAllowed` теперь использует **только** `SUPPORT_ALLOWED_TRANSITIONS` как allowlist (без объединения со стандартными переходами).
- Добавлен явный реестр `SUPPORT_BILLING_OVERRIDE_TARGETS = {ACTIVE_PAID, GRACE_PERIOD, EARLY_ACCESS}`. Попытка перехода в любое из этих состояний возвращает отдельный error-код `BILLING_OVERRIDE_NOT_ALLOWED` (упоминался в §10, но раньше нигде не выбрасывался) — это даёт forensic-аудиту мгновенно отличать «попытка обхода биллинга» от «обычная неподдерживаемая транзиция».
- `SUPPORT_ALLOWED_TRANSITIONS` остался без изменений: `{TRIAL_EXPIRED → TRIAL_ACTIVE, CLOSED → SUSPENDED}`.

### 2. Fail-fast валидация target state в `SetAccessStateDto`

[apps/api/src/modules/admin/support-actions/dto/set-access-state.dto.ts](apps/api/src/modules/admin/support-actions/dto/set-access-state.dto.ts)

Раньше DTO принимал любой `AccessState` через `@IsEnum(AccessState)` — billing-override target отсекался только в policy, после tenant pre-check'а и записи `support_actions` со status=blocked.

Теперь DTO сужен до явного whitelist'а через `@IsIn(['TRIAL_ACTIVE', 'SUSPENDED'])`, что:

- даёт оператору ясный 400 ещё до резолва tenant'а,
- дублирует security-инвариант на двух уровнях (defense-in-depth: DTO + policy),
- делает API-контракт самодокументирующим — список разрешённых target'ов виден прямо в DTO.

### 3. Forbidden actions registry

[apps/api/src/modules/admin/support-actions/forbidden-actions.ts](apps/api/src/modules/admin/support-actions/forbidden-actions.ts)

Создан явный реестр `FORBIDDEN_SUPPORT_ACTIONS` с категориями:

- **Impersonation:** `LOGIN_AS_USER`, `IMPERSONATE` — SUPPORT не получает session-токен tenant-пользователя ни через какой endpoint;
- **Plaintext-секреты:** `READ_PASSWORD_HASH`, `READ_PLAINTEXT_PASSWORD`, `READ_MARKETPLACE_CREDENTIALS` — tenant 360 отдаёт только status-поля (`credentialStatus`), но никогда сам секрет;
- **Billing override:** `BILLING_OVERRIDE`, `SPECIAL_FREE_ACCESS`, `GRANT_PAID_PLAN` — закрыто двумя слоями (DTO + policy);
- **Прямая запись в БД:** `RAW_SQL`, `DIRECT_DB_PATCH` — все mutation'ы идут только через доменные сервисы;
- **Действия, требующие отдельного review:** `DELETE_TENANT_HARD`, `DELETE_USER_HARD`, `EXPORT_TENANT_PII` — умышленно отсутствуют, фиксируем чтобы не «протекли».

Реестр НЕ исполняется в runtime-guard'е (нет «отрицательного» enforcement'а на каждый запрос — это бы только увеличило attack surface), но используется в integration-тесте как whitelist токенов, отсутствие которых в admin controller-маршрутах проверяется автоматически.

### 4. Тесты на security-инварианты

[apps/api/src/modules/tenants/access-state.policy.spec.ts](apps/api/src/modules/tenants/access-state.policy.spec.ts) — 13 тестов:

- разрешённые support-переходы (`TRIAL_EXPIRED → TRIAL_ACTIVE`, `CLOSED → SUSPENDED`) проходят;
- billing-override переходы (`SUSPENDED/TRIAL_ACTIVE/GRACE_PERIOD/CLOSED → ACTIVE_PAID`, `* → GRACE_PERIOD/EARLY_ACCESS`) бросают `BILLING_OVERRIDE_NOT_ALLOWED` — регрессия на старое поведение объединения standard+support;
- переходы вне SUPPORT_ALLOWED_TRANSITIONS, но не в billing-override target (например `CLOSED → TRIAL_ACTIVE`, `TRIAL_ACTIVE → SUSPENDED`) бросают обычный `TENANT_ACCESS_STATE_TRANSITION_NOT_ALLOWED`;
- `isWriteAllowed` корректно блокирует TRIAL_EXPIRED/SUSPENDED/CLOSED и разрешает активные state'ы.

[apps/api/src/modules/admin/support-actions/forbidden-actions.spec.ts](apps/api/src/modules/admin/support-actions/forbidden-actions.spec.ts) — 15 тестов (один параметризованный на каждый forbidden token):

- статически сканирует все `*.controller.ts` файлы в admin-модуле,
- проверяет, что ни один маршрут (`@Get/@Post/@Put/@Patch/@Delete/@Controller`) не содержит токенов из `FORBIDDEN_ADMIN_ROUTE_TOKENS`,
- ловит регрессии вида «разработчик добавил `POST /admin/users/:id/login-as` или `POST /admin/billing/grant-paid-plan`» ещё до раунд-трипа через Nest reflector.

**Итог тестового прогона:** 28 новых тестов passed; 207/207 admin/tenant/audit тестов passed (нет регрессий).

### 5. Уже-выполненные guardrail'ы (зафиксированы как ревью)

После аудита подтверждено, что следующие требования закрыты предыдущими задачами и новых изменений не потребовали:

| Требование TASK_ADMIN_5 | Где закрыто | Файл |
|--------------------------|-------------|------|
| Запрет impersonation/login-as-user | Отсутствие endpoint'а в `AdminModule` + регрессия forbidden-actions.spec | [admin.module.ts](apps/api/src/modules/admin/admin.module.ts) |
| Запрет plaintext credentials/passwords | `triggerPasswordResetBySupport` запускает обычный self-service reset flow и возвращает только `{sent, userId}` | [auth.service.ts:647](apps/api/src/modules/auth/auth.service.ts#L647) |
| `SUPPORT_READONLY` только на read | Все mutating controllers `@AdminRoles('SUPPORT_ADMIN')`; `SupportNotesController.list` без декоратора (любая активная роль) → отдаёт только публичные поля без IP/UA/correlation-id (T4) | [support-tenant-actions.controller.ts:33](apps/api/src/modules/admin/support-actions/support-tenant-actions.controller.ts#L33), [support-user-actions.controller.ts:29](apps/api/src/modules/admin/support-actions/support-user-actions.controller.ts#L29), [support-notes.controller.ts:44](apps/api/src/modules/admin/support-notes/support-notes.controller.ts#L44) |
| Mandatory `reason ≥ 10` | DTO `@MinLength(10)` + БД-инвариант `support_actions.reason NOT NULL` (T3) | [extend-trial.dto.ts](apps/api/src/modules/admin/support-actions/dto/extend-trial.dto.ts), [restore-tenant.dto.ts](apps/api/src/modules/admin/support-actions/dto/restore-tenant.dto.ts), [password-reset.dto.ts](apps/api/src/modules/admin/support-actions/dto/password-reset.dto.ts) |
| Отдельный support audit context | `writePrivilegedEvent` (visibility=internal_only, actorType=support) + `support_actions.audit_log_id` linkage (T4) | [support-actions.service.ts:425](apps/api/src/modules/admin/support-actions/support-actions.service.ts#L425) |
| `restore-tenant` только для CLOSED + retention window | `restoreTenantBySupport`: проверяет `tenant.status === 'CLOSED'` (иначе `TENANT_NOT_CLOSED`) и `closureJob.scheduledFor > now` (иначе `TENANT_RETENTION_WINDOW_EXPIRED`) | [tenant.service.ts:422](apps/api/src/modules/tenants/tenant.service.ts#L422) |

### Файлы

**Изменены:**
- [apps/api/src/modules/tenants/access-state.policy.ts](apps/api/src/modules/tenants/access-state.policy.ts) — closed billing-override gap;
- [apps/api/src/modules/admin/support-actions/dto/set-access-state.dto.ts](apps/api/src/modules/admin/support-actions/dto/set-access-state.dto.ts) — fail-fast whitelist toState.

**Созданы:**
- [apps/api/src/modules/admin/support-actions/forbidden-actions.ts](apps/api/src/modules/admin/support-actions/forbidden-actions.ts) — registry of forbidden actions;
- [apps/api/src/modules/tenants/access-state.policy.spec.ts](apps/api/src/modules/tenants/access-state.policy.spec.ts) — 13 тестов на support-policy security инвариантов;
- [apps/api/src/modules/admin/support-actions/forbidden-actions.spec.ts](apps/api/src/modules/admin/support-actions/forbidden-actions.spec.ts) — 15 регрессионных тестов на отсутствие forbidden-маршрутов в admin controllers.
