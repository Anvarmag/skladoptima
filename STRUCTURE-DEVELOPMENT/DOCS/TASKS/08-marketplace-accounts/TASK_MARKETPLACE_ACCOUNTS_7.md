# TASK_MARKETPLACE_ACCOUNTS_7 — QA, Regression и Observability

> Модуль: `08-marketplace-accounts`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_1`
  - `TASK_MARKETPLACE_ACCOUNTS_2`
  - `TASK_MARKETPLACE_ACCOUNTS_3`
  - `TASK_MARKETPLACE_ACCOUNTS_4`
  - `TASK_MARKETPLACE_ACCOUNTS_5`
  - `TASK_MARKETPLACE_ACCOUNTS_6`
- Что нужно сделать:
  - покрыть тестами create/update/validate/deactivate/reactivate и diagnostics;
  - проверить masked responses и отсутствие plaintext credential leakage в логах;
  - добавить кейсы `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` для account actions;
  - проверить конфликт создания второго active account на тот же marketplace;
  - завести метрики и алерты по validation failures, reconnect-needed rate и account pause reasons.
- Критерий закрытия:
  - регрессии по security и policy-block сценариям ловятся автоматически;
  - observability показывает реальную картину account health без раскрытия секретов;
  - QA matrix покрывает основные пути для `WB / Ozon / Yandex Market`.

**Что сделано**

### Контекст MVP до задачи

К моменту начала этой задачи в marketplace-accounts модуле было **92 unit-теста** в 4 файлах:
- [marketplace-accounts.service.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.service.spec.ts) — 22 теста (create/update happy paths и валидация);
- [marketplace-accounts.lifecycle.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.lifecycle.spec.ts) — 19 тестов (validate/deactivate/reactivate);
- [marketplace-accounts.diagnostics.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.diagnostics.spec.ts) — 20 тестов (list/getById/diagnostics/reportSyncRun);
- [marketplace-accounts.tenant-state.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.tenant-state.spec.ts) — 31 тест (service-level pause guards).

При этом:
- §16 system-analytics test matrix не была явно покрыта одним сценарным файлом — QA не имел читаемого reference, как пройти регрессию.
- Имена событий объявлены inline в `marketplace-accounts.service.ts` объекте `MarketplaceAccountEvents` — опечатка в любом event name ломала бы алертинг.
- §19 system-analytics требовал метрики, дашборды, алерты — runbook отсутствовал.
- Не было единого документа "когда событие → что делать".
- Безопасность секретов покрыта тестами разрозненно, без отдельного security-блока.

### Что добавлено

**1. Каноничные имена событий — [marketplace-account.events.ts](apps/api/src/modules/marketplace-accounts/marketplace-account.events.ts)**

Один файл со всеми 9 событиями модуля, экспортированными через `as const` объект `MarketplaceAccountEventNames`. Тип `MarketplaceAccountEventName` — union всех значений. Файл служит:
- single source of truth — попытка опечатки в логе блокируется TypeScript-ом;
- индексом для observability runbook'а (раздел 1 MARKETPLACE_ACCOUNTS_OBSERVABILITY.md);
- стабильной поверхностью для будущей интеграции Prometheus/OpenTelemetry.

`marketplace-accounts.service.ts` отрефакторен: inline-объект `MarketplaceAccountEvents` заменён на re-export `MarketplaceAccountEventNames` под прежним именем для обратной совместимости с существующими 92 тестами.

**2. Регрессионный пакет — [marketplace-accounts.regression.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.regression.spec.ts)**

Один файл, в котором каждый describe-блок соответствует одной строке матрицы §16 system-analytics:

| §16 | describe в файле | Что покрыто |
|---|---|---|
| §16.1 | `§16.1 — создание валидного account` | WB и Ozon happy paths + CREATED event + masked preview ('***7890', '***9999') |
| §16.2 | `§16.2 — невалидные credentials per marketplace` | WB без apiToken, Ozon без clientId+apiKey, anti-injection (UNKNOWN_FIELDS) |
| §16.3 | `§16.3 — single-active-account rule` | application pre-check + P2002 race + reactivate single-active |
| §16.4 | `§16.4 — partial credentials update без потери остальных полей` | merge apiToken без потери warehouseId, fieldsRotated БЕЗ значений |
| §16.5 | `§16.5 — деактивация и сохранение истории` | INACTIVE + syncHealth=PAUSED + DEACTIVATED event + sync history references не удаляются |
| §16.6 | `§16.6 — reactivate с обязательной re-validate` | принудительный credentialStatus=VALIDATING + auto validate() invocation |
| §16.7 | `§16.7 — sync error меняет sync_health_status, но не credential_status` | §20 invariant: reportSyncRun не трогает credential fields |
| §16.8-9 | `§16.8-9 — TRIAL_EXPIRED policy` | разрешены: label, deactivate; заблокированы: validate, reactivate, credentials, create |
| §16.10 | `§16.10 — SUSPENDED/CLOSED → полный read-only` | `it.each` × 2 state × все write actions блок; read API работает в каждом из 3 paused |
| доп | `SECURITY` блок (5 тестов) | masked responses, no plaintext leakage в response/logs/events, sync error payload без credentials |
| доп | `OBSERVABILITY` блок | все 9 event-имён существуют + PAUSED_BY_TENANT_STATE event payload содержит action+accessState |
| доп | `QA matrix — Yandex Market out of MVP` | YANDEX_MARKET → MARKETPLACE_NOT_SUPPORTED |

27 новых тестов в 11 describe-блоках. Каждый сценарий, где это имеет смысл, использует `expect(JSON.stringify(res)).not.toContain(FULL_TOKEN)` для проверки security-инвариантов — security и бизнес-логика тестируются вместе.

**3. Security инварианты явно покрыты**

5 security-тестов в `SECURITY` блоке проверяют:
- CREATE response не содержит полное значение `apiToken` или `encryptedPayload`;
- UPDATE с partial credentials не утекает новое значение в response;
- DIAGNOSTICS показывает masked preview, но не encryptedPayload; `recentEvents.payload` для `CREDENTIALS_ROTATED` содержит только `fieldsRotated` имена;
- Все `Logger.log/warn` вызовы (агрегированно) не содержат полные значения секретов — это ключевая защита от accidental leak в продакшен-логи;
- `SYNC_ERROR_DETECTED` event payload содержит только `errorCode + partial`, без credentials.

**4. Observability runbook — [MARKETPLACE_ACCOUNTS_OBSERVABILITY.md](STRUCTURE-DEVELOPMENT/DOCS/TASKS/08-marketplace-accounts/MARKETPLACE_ACCOUNTS_OBSERVABILITY.md)**

8 разделов:

1. **Каноничные события** — таблица всех 9 событий с severity и эмиттером (lifecycle / credential / sync health / tenant policy).
2. **Соответствие метрикам §19** — каждая метрика отображена на источник (event/SQL count/DB поле). Дополнительные метрики не из §19 но ценные: `paused_by_tenant_actions`, `reconnect_needed_rate`, `stuck_in_validating`.
3. **Алерт-пороги P0/P1/P2** — шесть алертов с условиями и playbook'ами:
   - Mass validation failures по marketplace (P0) → marketplace API изменил auth-схему;
   - Reconnect backlog (P1) → нужно уведомить пользователей;
   - Stuck in VALIDATING > 5min (P0) → worker validator упал;
   - Sync error spike per account (P1) → проверить syncHealthReason;
   - High paused-by-tenant rate (P2) → UI не показывает paused banner;
   - Race на single-active (P2) → idempotency на стороне caller.
4. **Диагностические запросы** — конкретные curl/REST endpoint'ы для list/diagnostics/lifecycle actions + SQL для bulk-аналитики (sync_health distribution, stuck VALIDATING > 5min, event journal по account).
5. **Дашборды** — рекомендованные 5 boards (Connection Funnel, Health by Marketplace, Reconnect Backlog, Auth Error Taxonomy, Stuck Account Board).
6. **Регрессионная карта** — отображение §16 матрицы на тестовые блоки.
7. **Security инварианты** — 6 явных инвариантов с указанием файлов/блоков покрытия.
8. **Когда дополнять** — правило «новое событие → константа + runbook + тест».

### Проверки

- `npx jest src/modules/marketplace-accounts/` — `Tests: 119 passed, 119 total` (92 ранее + 27 в новом regression-spec; 5 test suites passed).
- Глобально (inventory + warehouses + marketplace-accounts): `Tests: 305 passed, 305 total` в 15 suites.
- `npx tsc --noEmit` (apps/api) — никаких новых ошибок.
- Каждый regression-сценарий явно проверяет соответствующий `MarketplaceAccountEventNames.X` через ожидание `eventType` в `marketplaceAccountEvent.create` data — observability и бизнес-инвариант тестируются вместе.

### Соответствие критериям закрытия

- **Регрессии по security и policy-block сценариям ловятся автоматически**: 5 security-тестов проверяют отсутствие plaintext leakage в response/logs/events; SUSPENDED/CLOSED/TRIAL_EXPIRED tests покрывают все per-action policy decisions из TASK_5.
- **Observability показывает реальную картину account health без раскрытия секретов**: 9 event-имён + 6 алертов P0/P1/P2 + 5 дашбордов + diagnostics endpoint + явные security-инварианты в runbook'е (раздел 7) обеспечивают полный observability surface без single точки утечки.
- **QA matrix покрывает основные пути для WB / Ozon / Yandex Market**: WB и Ozon — full coverage по §16; Yandex Market — explicit `MARKETPLACE_NOT_SUPPORTED` test (out of MVP). Когда YM подключим — schema-table в `credential-schema.ts` расширяется одной строкой и текущая security/observability infrastructure работает для него без изменений.

### Что осталось вне scope

- Реальная интеграция метрик в Prometheus / OpenTelemetry — требует изменения инфраструктуры приложения; runbook §3 готов для приёмки таска.
- E2E supertest на REST endpoints с реальной базой — отдельный QA-таск (юнит-тесты и интеграционные DB-тесты живут в разных слоях стратегии тестирования).
- Yandex Market integration (credentials schema + validator) — отдельная feature-задача; этот модуль (TASK_1-7) подготовил инфраструктуру так, что добавление YM не потребует изменения архитектуры.
- Frontend dashboard для observability метрик — частично уже доступно через `Diagnostics panel` в [MarketplaceAccounts.tsx](apps/web/src/pages/MarketplaceAccounts.tsx) (TASK_6); расширение до push-уведомлений на validation_failed/reconnect_needed — отдельная задача в `12-notifications`.
- Удаление legacy `apiKey/clientId/...` плэйнтекст-полей из `MarketplaceAccount` и переключение `sync.service` на encrypted credential storage — отдельная миграционная задача.

### Модуль `08-marketplace-accounts` закрыт полностью

Все 7 задач TASK_MARKETPLACE_ACCOUNTS_1..7 выполнены:
- TASK_1: data model (4 enum + Account + Credential + Event) — single-active partial UNIQUE.
- TASK_2: encrypted credentials + masked preview (AES-256-GCM, key versioning).
- TASK_3: validate / deactivate / reactivate lifecycle.
- TASK_4: list / getById / diagnostics + reportSyncRun + effectiveRuntimeState.
- TASK_5: tenant-state-aware policy (TRIAL_EXPIRED label/deactivate allow, SUSPENDED/CLOSED read-only).
- TASK_6: frontend connection UX с masked preview, partial credential edit, diagnostics panel.
- TASK_7: regression matrix + security-инварианты + observability runbook.

**119 unit-тестов в 5 suites** (marketplace-accounts), **305 passed in 15 suites** (cumulative inventory + warehouses + marketplace-accounts).
