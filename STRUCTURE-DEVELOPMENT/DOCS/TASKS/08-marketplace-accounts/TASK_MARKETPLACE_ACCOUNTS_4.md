# TASK_MARKETPLACE_ACCOUNTS_4 — Diagnostics, Sync Health и Event Model

> Модуль: `08-marketplace-accounts`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_1`
  - `TASK_MARKETPLACE_ACCOUNTS_3`
- Что нужно сделать:
  - реализовать `GET /api/v1/marketplace-accounts/:id/diagnostics`;
  - показывать отдельно `lifecycle`, `credential status`, `sync health`, `effective runtime state`;
  - хранить и отдавать `last_validation_error_*`, `last_sync_error_*`, `sync_health_reason`;
  - описать доменные события `marketplace_account_created`, `validated`, `validation_failed`, `deactivated`, `reactivated`;
  - не раскрывать в diagnostics чувствительные части credential payload.
- Критерий закрытия:
  - diagnostics помогает отличать auth-проблему от sync degradation и policy pause;
  - UI и support видят одни и те же безопасные диагностические поля;
  - event model пригодна для audit/notifications/worker integration.

**Что сделано**

### Контекст MVP до задачи

К моменту начала задачи в проекте:
- `MarketplaceAccountsService` (TASK_2-3) умел `create/update/validate/deactivate/reactivate` со всеми lifecycle событиями.
- На `MarketplaceAccount` уже были все error-поля (`lastValidationError*`, `lastSyncError*`, `syncHealthReason`) — но никаких read endpoint'ов, чтобы их посмотреть.
- В legacy [SettingsService](apps/api/src/modules/marketplace/settings.service.ts) был только flat-getter `getSettings(tenantId)` с плэйнтекстовыми ключами и без статусов / диагностики.

Чего НЕ было:
- `GET /marketplace-accounts` (list) и `GET /:id` (карточка) с masked preview.
- `GET /:id/diagnostics` с трёхслойным статус-view + recent events.
- **Effective runtime state** — единого ответа «может ли account работать прямо сейчас» (UI вынуждена была композировать из 4 полей: tenant accessState + lifecycle + credential + sync health).
- `reportSyncRun` метода для записи sync-health полей из sync.service / worker.

### Что добавлено

**1. Read endpoints в [marketplace-accounts.controller.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.controller.ts)**

```
GET /marketplace-accounts                       — list с фильтрами marketplace/lifecycleStatus/credentialStatus
GET /marketplace-accounts/:id                   — карточка
GET /marketplace-accounts/:id/diagnostics       — расширенная диагностика
```

Все — read-only, защищены `RequireActiveTenantGuard` (без `TenantWriteGuard`, потому что чтение справочника доступно даже в paused state — пользователь должен видеть, что у него есть, до оплаты подписки). Хелпер `_asEnum` парсит query case-insensitive с whitelist по `Object.values`.

**2. `MarketplaceAccountsService.list(tenantId, opts)`**

Tenant-scoped, prisma `findMany` с фильтрами. Сортировка `(lifecycleStatus asc, marketplace asc, label asc)` — ACTIVE наверх, в группе по marketplace по алфавиту. Включает `credential` для построения masked preview через `_toReadModel`. **Никогда не возвращает `encryptedPayload`** — тест явно проверяет `expect(JSON.stringify(res)).not.toContain('encryptedPayload')`.

**3. `MarketplaceAccountsService.getById(tenantId, accountId)`**

Тенант-скопед `findFirst`, 404 для чужого/несуществующего, тот же `_toReadModel`.

**4. `MarketplaceAccountsService.getDiagnostics(tenantId, accountId)`** — главное новое API

Расширенный response:

```typescript
{
  // ...всё из read-model (id, marketplace, label, статусы, masked credential, ...)
  tenantAccessState: 'ACTIVE_PAID' | 'TRIAL_EXPIRED' | ...,
  effectiveRuntimeState: 'OPERATIONAL' | 'PAUSED_BY_TENANT' | 'CREDENTIAL_BLOCKED' | 'SYNC_DEGRADED' | 'INACTIVE',
  effectiveRuntimeReason: string | null,           // human-readable hint
  statusLayers: {
    lifecycle: { status, deactivatedAt, deactivatedBy },
    credential: { status, lastValidatedAt, lastValidationErrorCode, lastValidationErrorMessage },
    syncHealth: { status, reason, lastSyncAt, lastSyncResult, lastSyncErrorCode, lastSyncErrorMessage },
  },
  recentEvents: [{ id, eventType, createdAt, payload }, ...50],
}
```

Это и есть «помогает отличать auth-проблему от sync degradation и policy pause» из DoD: вместо одного красного индикатора UI получает 4 раздельных слоя + единый `effectiveRuntimeState`.

**5. `_computeEffectiveRuntime` — приоритет источников**

```
1. tenant.accessState IN (TRIAL_EXPIRED/SUSPENDED/CLOSED) → PAUSED_BY_TENANT  (перебивает всё)
2. lifecycleStatus = INACTIVE                              → INACTIVE
3. credentialStatus IN (INVALID, NEEDS_RECONNECT)          → CREDENTIAL_BLOCKED
4. syncHealthStatus IN (ERROR, DEGRADED)                   → SYNC_DEGRADED
5. иначе                                                   → OPERATIONAL
```

Порядок неслучайный: tenant-pause всегда первым (commercial policy сильнее всех технических флагов); дальше lifecycle; потом credential (без них вообще ничего не работает); sync-degraded — самый «мягкий» уровень (account работоспособен, но текущий sync run прошёл неудачно). VALIDATING/UNKNOWN — тоже не блокируют (tест явно: `credentialStatus=VALIDATING → effectiveRuntimeState=OPERATIONAL`).

**6. `reportSyncRun(tenantId, accountId, result)` — публичный API для sync.service / worker**

Записывает только sync-health поля (lastSyncAt, lastSyncResult, syncHealthStatus, syncHealthReason, lastSyncError*). **НЕ трогает** `credentialStatus`/`lastValidationError*` — §20 invariant подтверждён отдельным тестом `expect(updateData).not.toHaveProperty('credentialStatus')`.

Маппинг входящего результата:
- `ok: true` (no partial) → `lastSyncResult=SUCCESS`, `syncHealthStatus=HEALTHY`, `syncHealthReason=null`;
- `ok: true, partial: true` → `PARTIAL_SUCCESS` + `DEGRADED` + `healthReason`;
- `ok: false` → `FAILED` + `ERROR` + `syncHealthReason = healthReason ?? errorCode ?? 'SYNC_FAILED'`. На ошибке эмитится `MARKETPLACE_ACCOUNT_SYNC_ERROR_DETECTED` event с `{errorCode, partial}` payload + warn-лог.

**7. Event model — каноничные имена в `MarketplaceAccountEvents`**

Расширен до 9 типов с группировкой:

| Группа | События |
|---|---|
| **Lifecycle** | `CREATED`, `DEACTIVATED`, `REACTIVATED` |
| **Credential** | `LABEL_UPDATED`, `CREDENTIALS_ROTATED`, `VALIDATED`, `VALIDATION_FAILED` |
| **Sync health** | `SYNC_ERROR_DETECTED` (новое в TASK_4 — публикуется через `reportSyncRun`) |
| **Tenant state** | `PAUSED_BY_TENANT_STATE` (зарезервировано для TASK_5) |

Все строки соответствуют §15 system-analytics. Single source of truth — `MarketplaceAccountEvents` в [marketplace-accounts.service.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.service.ts).

**8. Тесты — [marketplace-accounts.diagnostics.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.diagnostics.spec.ts)**

20 новых тестов в 4 describe-блоках:

*list / getById (3):* read-model без encryptedPayload (`not.toContain` проверка); фильтры пробрасываются в `where`; getById NotFound для чужого.

*effectiveRuntimeState (6):*
- OPERATIONAL для нормального состояния;
- `it.each` на 3 paused-state перебивает credential/sync (даже если `INVALID + ERROR`);
- INACTIVE перебивает credential/sync (даже VALID + HEALTHY);
- CREDENTIAL_BLOCKED для INVALID и NEEDS_RECONNECT;
- SYNC_DEGRADED для ERROR;
- VALIDATING НЕ блокирует.

*статус-слои и события (4):* три отдельных слоя с error-полями (lifecycle/credential/syncHealth); recentEvents с payload (включая `CREDENTIALS_ROTATED.payload.fieldsRotated` без значений секретов); credential.maskedPreview виден, encryptedPayload — нет; NotFound.

*reportSyncRun (5):* `ok=true → SUCCESS+HEALTHY` без SYNC_ERROR_DETECTED event; `ok+partial → PARTIAL_SUCCESS+DEGRADED+healthReason`; `ok=false → FAILED+ERROR+SYNC_ERROR_DETECTED event с errorCode payload`; **§20 invariant** — `reportSyncRun` НЕ трогает credential fields; NotFound.

Совокупно — `Tests: 61 passed, 61 total` для модуля (22 TASK_2 + 19 TASK_3 + 20 TASK_4). Глобально (inventory + warehouses + marketplace-accounts): `Tests: 247 passed, 247 total` в 13 suites. `tsc --noEmit` чисто.

### Соответствие критериям закрытия

- **Diagnostics помогает отличать auth-проблему от sync degradation и policy pause**: `effectiveRuntimeState` даёт четыре дискретных значения — `PAUSED_BY_TENANT` / `INACTIVE` / `CREDENTIAL_BLOCKED` / `SYNC_DEGRADED` / `OPERATIONAL`. Разные категории алертов идут по разным путям UI/notifications.
- **UI и support видят одни и те же безопасные диагностические поля**: единый response `getDiagnostics`, статус-слои + error fields + recent events, никаких полных значений секретов (тест `expect(json).not.toContain` явный); maskedPreview одинаковый для UI и support.
- **Event model пригодна для audit/notifications/worker integration**: 9 каноничных event-имён покрывают весь жизненный цикл; `MarketplaceAccountEvent` — append-only журнал с `tenantId/accountId/eventType/payload/createdAt`, индексирован для быстрого pull (TASK_1); `reportSyncRun` — официальный entry-point для sync.service / worker без дублирования эвент-логики.

### Что осталось вне scope

- Tenant-state guards (label-only update + deactivate допустимы в TRIAL_EXPIRED, validate/reactivate — нет; service-level pause check для прямых вызовов из jobs) — TASK_5.
- RBAC через `RolesGuard` (Owner/Admin only для write, Owner/Admin/Manager для read/diagnostics) — TASK_5.
- Frontend UX подключений с тремя слоями статуса и diagnostic banner — TASK_6.
- Observability runbook + QA matrix — TASK_7.
- Подключение sync.service к `reportSyncRun` (вместо текущей записи `lastSyncAt/lastSyncStatus String?` legacy полей) — отдельная задача после TASK_5.
