# Marketplace Accounts — Observability Runbook

> Раздел: `08-marketplace-accounts`
> Последнее обновление: 2026-04-26 (TASK_MARKETPLACE_ACCOUNTS_7)
> Связанные документы: `system-analytics.md` §15/§19, `marketplace-account.events.ts`

Операционный справочник для модуля marketplace-accounts: какие события эмитятся,
каким метрикам §19 они соответствуют, какие пороги алертов и какие
диагностические запросы запускать при инциденте.

## 1. Каноничные события

Все имена — константы в `apps/api/src/modules/marketplace-accounts/marketplace-account.events.ts`,
реэкспортированы в сервисе как `MarketplaceAccountEvents` для обратной
совместимости. Все события записываются:
1. В БД-журнал `MarketplaceAccountEvent` (append-only, индексирован per
   tenant+account+createdAt и per tenant+eventType+createdAt) — это audit chain;
2. В structured-логи через `Logger.log/warn/error` — это на pickup для
   Loki/CloudWatch/etc.

| Событие | Severity | Эмиттер | Когда срабатывает |
|---|---|---|---|
| `marketplace_account_created` | info | `create` | Новое подключение успешно создано |
| `marketplace_account_label_updated` | info | `update` | Изменено только название (label) |
| `marketplace_account_credentials_rotated` | info | `update` | Обновлены секреты (payload содержит ТОЛЬКО `fieldsRotated` имена) |
| `marketplace_account_validated` | info | `validate` | Внешний health-check успешен → `credentialStatus=VALID` |
| `marketplace_account_validation_failed` | warn | `validate` | Внешний health-check вернул ошибку (auth/forbidden/4xx) |
| `marketplace_account_deactivated` | info | `deactivate` | `lifecycleStatus=INACTIVE`, sync поставлен на паузу |
| `marketplace_account_reactivated` | info | `reactivate` | `lifecycleStatus=ACTIVE` + автоматический re-validate |
| `marketplace_account_sync_error_detected` | warn | `reportSyncRun` | Sync.service записал failed run, sync_health=ERROR |
| `marketplace_account_paused_by_tenant_state` | warn | `_assertExternal*` / `_assertInternal*` | Попытка action заблокирована tenant accessState |

## 2. Соответствие метрикам §19 system-analytics

| Метрика §19 | Источник | Где брать |
|---|---|---|
| `accounts_created` | `marketplace_account_created` | count(MarketplaceAccountEvent where eventType=created) |
| `accounts_connected` | `marketplace_account_validated` | count(events) per (tenant, account) с лагом ≤1 час после CREATED |
| `validation_failed` | `marketplace_account_validation_failed` | count(events) или `MarketplaceAccount.credentialStatus IN (INVALID, NEEDS_RECONNECT)` |
| `credentials_rotated` | `marketplace_account_credentials_rotated` | count(events) per `fieldsRotated` |
| `account_disabled` | `marketplace_account_deactivated` | count(events) или `MarketplaceAccount.lifecycleStatus=INACTIVE` |
| `health_degraded` | `MarketplaceAccount.syncHealthStatus IN (DEGRADED, ERROR)` | sum(accounts) per status |

Дополнительно (не указано в §19, но ценно):

| Метрика | Источник | Применение |
|---|---|---|
| `paused_by_tenant_actions` | `marketplace_account_paused_by_tenant_state` | rate alert: пользователь упёрся в paused state |
| `reconnect_needed_rate` | `MarketplaceAccount.credentialStatus=NEEDS_RECONNECT` | sum(accounts) — backlog для notifications |
| `stuck_in_validating` | `MarketplaceAccount.credentialStatus=VALIDATING` AND `now() - updatedAt > 5min` | sync.service / validator stuck |

## 3. Алерт-пороги (P0/P1/P2)

Спецификация для будущей интеграции с Prometheus/Grafana.

| Алерт | Условие | Severity | Что делать |
|---|---|---|---|
| **Mass validation failures по marketplace** | `validation_failed rate > 10/час` для одного marketplace (WB или Ozon) | P0 | Marketplace API изменил auth-схему, или массовый отзыв ключей. Проверить `lastValidationErrorCode` distribution — если все `AUTH_UNAUTHORIZED`, скорее массовая инвалидация токенов. |
| **Reconnect backlog** | `count(credentialStatus=NEEDS_RECONNECT) > 10` | P1 | Нужно уведомить пользователей через `12-notifications`. Каждый аккаунт требует ручного reconnect через UI. |
| **Stuck in VALIDATING** | `credentialStatus=VALIDATING AND now() - updatedAt > 5min` | P0 | Worker validator упал между `set VALIDATING` и финальным update. Проверить логи validator'а; может потребоваться ручной reset через update. |
| **Sync error spike per account** | `marketplace_account_sync_error_detected` rate > 5/час для одного account | P1 | Sync.service ошибается на этом аккаунте. Проверить `syncHealthReason` и `lastSyncErrorCode`. Если кейс рейт-лимитов — уменьшить полл-частоту. |
| **High paused-by-tenant rate** | `marketplace_account_paused_by_tenant_state` rate > 50/час для одного tenant | P2 | UI не показывает paused banner или scheduler продолжает дёргаться в paused state. Проверить, что MainLayout AccessStateBanner работает; `12-notifications` должен оповестить пользователя. |
| **Race на single-active** | `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` rate > 1/час из P2002 catch | P2 | UI/scheduler делают create параллельно. Проверить idempotency на стороне caller. |

## 4. Диагностические запросы

Все требуют tenant-scoped доступ через `RequireActiveTenantGuard`.

### 4.1 Список аккаунтов с фильтрами по статусам

```
GET /api/v1/marketplace-accounts?credentialStatus=INVALID
GET /api/v1/marketplace-accounts?credentialStatus=NEEDS_RECONNECT
GET /api/v1/marketplace-accounts?lifecycleStatus=INACTIVE
GET /api/v1/marketplace-accounts?marketplace=WB
```

### 4.2 Карточка с masked preview

```
GET /api/v1/marketplace-accounts/<id>
```

### 4.3 Полная диагностика (4 слоя + recent events)

```
GET /api/v1/marketplace-accounts/<id>/diagnostics
```

Возвращает:
- `effectiveRuntimeState` (`OPERATIONAL / PAUSED_BY_TENANT / CREDENTIAL_BLOCKED / SYNC_DEGRADED / INACTIVE`);
- `effectiveRuntimeReason` (machine-readable hint);
- `statusLayers.{lifecycle, credential, syncHealth}` с error fields;
- `recentEvents[50]` из `MarketplaceAccountEvent` журнала.

**Главный артефакт инцидент-расследования.** Поделившись response с support'ом,
вы даёте им всю безопасную диагностическую картину без раскрытия секретов.

### 4.4 Ручная валидация / реактивация / отключение

```
POST /api/v1/marketplace-accounts/<id>/validate     (TenantWriteGuard, external API call)
POST /api/v1/marketplace-accounts/<id>/deactivate   (внутреннее, разрешено в TRIAL_EXPIRED)
POST /api/v1/marketplace-accounts/<id>/reactivate   (TenantWriteGuard + auto re-validate)
```

### 4.5 SQL-запросы для bulk-аналитики

Сводная картина по credentialStatus:
```sql
SELECT "marketplace", "credentialStatus", COUNT(*)
FROM "MarketplaceAccount"
WHERE "tenantId" = $1
GROUP BY "marketplace", "credentialStatus";
```

Stuck в VALIDATING > 5 минут:
```sql
SELECT "id", "tenantId", "marketplace", "label", "updatedAt"
FROM "MarketplaceAccount"
WHERE "credentialStatus" = 'VALIDATING'
  AND NOW() - "updatedAt" > INTERVAL '5 minutes';
```

### 4.6 Поиск конкретного event-типа в журнале

```sql
SELECT "createdAt", "eventType", "payload"
FROM "MarketplaceAccountEvent"
WHERE "tenantId" = $1
  AND "accountId" = $2
ORDER BY "createdAt" DESC
LIMIT 100;
```

## 5. Дашборды (рекомендованный набор)

Когда будет интеграция с Grafana / OpenSearch / аналог:

- **Connection Funnel** — за окно 24h: `accounts_created` → `accounts_validated_first_time`. Drop-off показывает onboarding friction.
- **Health by Marketplace** — pie: `credentialStatus` distribution per `marketplace`.
- **Reconnect Backlog Board** — список `credentialStatus=NEEDS_RECONNECT` с `lastValidationErrorMessage`, age, tenantId.
- **Auth Error Taxonomy** — bar chart по `lastValidationErrorCode` → видно, какие именно ошибки доминируют.
- **Stuck Account Board** — accounts в VALIDATING / PROCESSING состояниях > 5 минут.

## 6. Регрессионная карта (тесты)

Покрытие §16 system-analytics test matrix:

| Сценарий §16 | Файл / describe |
|---|---|
| Создание валидного account (WB / Ozon) | `marketplace-accounts.regression.spec.ts §16.1` |
| Создание с неверными credentials (валидация полей) | `marketplace-accounts.regression.spec.ts §16.2` |
| Попытка второго active того же marketplace | `marketplace-accounts.regression.spec.ts §16.3` (3 теста: pre-check, P2002, reactivate) |
| Обновление credentials (partial) | `marketplace-accounts.regression.spec.ts §16.4` |
| Деактивация account (sync history сохранена) | `marketplace-accounts.regression.spec.ts §16.5` |
| Reactivate с обязательной re-validate | `marketplace-accounts.regression.spec.ts §16.6` |
| Sync error не ломает credential validity (§20 invariant) | `marketplace-accounts.regression.spec.ts §16.7` |
| TRIAL_EXPIRED → label/deactivate allowed, остальное блок | `marketplace-accounts.regression.spec.ts §16.8-9` |
| SUSPENDED/CLOSED → read-only mode | `marketplace-accounts.regression.spec.ts §16.10` |
| Yandex Market: out of MVP | `marketplace-accounts.regression.spec.ts QA matrix` |
| **Security**: masked responses, no plaintext leakage | `marketplace-accounts.regression.spec.ts SECURITY` (5 тестов) |
| **Observability**: каноничные event names | `marketplace-accounts.regression.spec.ts OBSERVABILITY` |

Дополнительно (unit-spec'ы per-операция):
- `marketplace-accounts.service.spec.ts` — create/update happy paths и валидация (22);
- `marketplace-accounts.lifecycle.spec.ts` — validate/deactivate/reactivate (19);
- `marketplace-accounts.diagnostics.spec.ts` — list/getById/diagnostics/reportSyncRun (20);
- `marketplace-accounts.tenant-state.spec.ts` — service-level pause guards (31);
- `marketplace-accounts.regression.spec.ts` — §16 + security + observability (27).

Совокупно: **119 тестов в 5 suites** (marketplace-accounts module).
Глобально (inventory + warehouses + marketplace-accounts): **305 passed, 15 suites**.

## 7. Security инварианты (явно покрыты тестами)

1. **Полные значения секретов никогда не возвращаются в API response** (тест `expect(JSON.stringify(res)).not.toContain(FULL_TOKEN)` на CREATE / UPDATE / DIAGNOSTICS).
2. **`encryptedPayload Bytes` никогда не утекает за пределы adapter-слоя** (тест `not.toContain('encryptedPayload')`).
3. **Structured-логи не содержат полных значений секретов** (тест собирает все `Logger.log/warn` вызовы и проверяет отсутствие full token).
4. **`CREDENTIALS_ROTATED` event payload содержит только `fieldsRotated` имена**, БЕЗ значений (тест на содержимое `payload`).
5. **`SYNC_ERROR_DETECTED` payload содержит errorCode**, БЕЗ credentials.
6. **Anti-injection**: лишние ключи в credentials → `CREDENTIALS_UNKNOWN_FIELDS`, отсекаются до encrypt'а.

## 8. Когда дополнять

Каждый раз, когда добавляется новый observable путь:
1. Новая константа в `marketplace-account.events.ts`.
2. Раздел в этом документе (соответствие метрике, severity, что делать).
3. Тест в `marketplace-accounts.regression.spec.ts` (OBSERVABILITY block).
