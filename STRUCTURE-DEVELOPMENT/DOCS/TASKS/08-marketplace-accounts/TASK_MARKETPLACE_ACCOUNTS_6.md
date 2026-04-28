# TASK_MARKETPLACE_ACCOUNTS_6 — Frontend Connection UX и Diagnostics

> Модуль: `08-marketplace-accounts`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_2`
  - `TASK_MARKETPLACE_ACCOUNTS_4`
  - `TASK_MARKETPLACE_ACCOUNTS_5`
- Что нужно сделать:
  - собрать список account с индикаторами `lifecycle`, `credential`, `sync health`;
  - реализовать create/edit form с masked credential preview и безопасным обновлением секретов;
  - вывести diagnostics panel с причинами `invalid`, `needs_reconnect`, `degraded`, `paused`;
  - корректно блокировать actions в `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - сделать ясный UX для single active account per marketplace.
- Критерий закрытия:
  - пользователь понимает, account неактивен из-за credentials, sync health или tenant policy;
  - UI не показывает запрещенные action buttons;
  - reconnect/edit flows не требуют повторного ввода всех secret-полей без необходимости.

**Что сделано**

### Контекст MVP до задачи

К моменту начала задачи в проекте:
- Backend полностью готов: TASK_2-5 закрыты — create/update/validate/deactivate/reactivate, masked preview, diagnostics с `effectiveRuntimeState`, tenant-state-aware policy.
- Существующая web-страница [Settings.tsx](apps/web/src/pages/Settings.tsx) использовала legacy [SettingsService](apps/api/src/modules/marketplace/settings.service.ts) с плэйнтекстовой flat-формой (одно поле для каждого секрета без masked preview, никаких lifecycle/credential/sync статусов, никакой диагностики, никакой safety-блокировки в paused state). Связи с canonical `MarketplaceAccountsService` (TASK_2-5) у фронта не было.
- [AccessStateBanner](apps/web/src/components/AccessStateBanner.tsx) глобально активен в [MainLayout](apps/web/src/layouts/MainLayout.tsx).

Чего НЕ было:
- Frontend для нового canonical API с тремя слоями статуса.
- UX масок секретов и partial credential update (без принудительного повторного ввода всех полей).
- Diagnostic panel с `effectiveRuntimeState` объяснением и recent events.
- Различия per-action policy в UI: TRIAL_EXPIRED → label/deactivate доступны, остальное заблокировано; SUSPENDED/CLOSED → полный read-only.

### Что добавлено

**1. Новая страница [MarketplaceAccounts.tsx](apps/web/src/pages/MarketplaceAccounts.tsx)**

Master-detail layout (3/5 + 2/5 на desktop):

- **Quick add buttons** для каждого marketplace (`Подключить Wildberries`, `Подключить Ozon`). Disabled с tooltip-объяснением, если:
  - уже есть active аккаунт того же marketplace (single-active rule, §10);
  - `externalBlocked` (TRIAL_EXPIRED/SUSPENDED/CLOSED).
- **Список (3/5 ширины)**: таблица с колонками `Подключение / Жизн. цикл / Ключи / Sync / Действия`. Каждая строка показывает 4 цветных бейджа (marketplace + 3 статусных слоя) — UI явно различает «ключи невалидны» vs «sync деградирован» vs «отключено вручную».
- **Detail panel (2/5)**: полная диагностика выбранного подключения через `GET /marketplace-accounts/:id/diagnostics` (TASK_4).

**2. Diagnostics panel — три слоя статуса + effective runtime state**

В `detail-panel`:
- **Большой бейдж `EFFECTIVE_LABEL[effectiveRuntimeState]`** в шапке: `Работает` / `Пауза по тарифу` / `Блок: ключи` / `Sync деградирован` / `Отключён вручную`.
- **Hint-параграф `EFFECTIVE_HINT`** объясняет пользователю на простом языке, что происходит и что делать (например, `«Credentials в порядке, но последний sync run прошёл с ошибкой»`).
- **Машинный `effectiveRuntimeReason`** мелким шрифтом — для support'а и отладки.
- **3 status-cards** в grid 3-колонками: lifecycle / credential / sync, каждая с собственным цветным бейджем + подробностью (errorCode, errorMessage, lastValidatedAt/lastSyncAt).
- **Tenant access state hint** — отдельная карточка `bg-amber-50` появляется ТОЛЬКО когда `effectiveRuntimeState === 'PAUSED_BY_TENANT'` с явным указанием состояния подписки и CTA.
- **Recent events** — последние 50 из `MarketplaceAccountEvent` журнала. Event type сокращается через `shortenEvent('marketplace_account_validated' → 'validated')`. `summarizePayload` форматирует payload в человеческий текст:
  - `credentials_rotated → обновлены: apiToken` (БЕЗ значения секрета);
  - `label_updated → "Old" → "New"`;
  - `validation_failed → ошибка: AUTH_UNAUTHORIZED`;
  - `sync_error_detected → ошибка sync: HTTP_500`;
  - `paused_by_tenant_state → validate → TRIAL_EXPIRED`.

**3. Action buttons с per-action блокировкой по tenant state**

Логика двух constants:
```
WRITE_BLOCKED_STATES = ['SUSPENDED', 'CLOSED']                       // полный read-only
EXTERNAL_API_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'] // блок validate/reactivate/create/credentials
```

| Action | Disabled при | Иконка disabled | Tooltip |
|---|---|---|---|
| Quick add (`Подключить WB/Ozon`) | externalBlocked OR exists active | `Lock` | externalHint OR «Активный аккаунт уже есть, отключите старый» |
| `Проверить` (validate) | externalBlocked | `Lock` | externalHint |
| `Изменить` (open edit modal) | writeBlocked | `Lock` | writeHint |
| `Отключить` (deactivate) | writeBlocked | `Lock` | writeHint |
| `Включить` (reactivate) | externalBlocked | `Lock` | externalHint |

Это точно отражает per-action service-level policy из TASK_5: TRIAL_EXPIRED разрешает label-update + deactivate, всё остальное блокирует. SUSPENDED/CLOSED — read-only.

**4. Create/Edit modal с partial credential update**

Динамический список полей под выбранный marketplace (зеркалит §13):
- WB: required `apiToken`, `warehouseId` + optional `statToken`;
- Ozon: required `clientId`, `apiKey`, `warehouseId`.

В режиме **edit**:
- Карточка `bg-slate-50` показывает текущий masked preview (например, `apiToken: ***7890`) — пользователь видит, что есть, без раскрытия;
- Все поля credentials изначально пустые; placeholder для secret-полей — `«Не менять»`;
- В body PATCH запроса попадают **только тронутые** поля (`formSecretsTouched`) — критерий «reconnect/edit flows не требуют повторного ввода всех secret-полей без необходимости» закрыт;
- Для не-секретных полей (`warehouseId/clientId`) поведение симметрично — обновляются только если изменены.

В режиме **create**:
- Required-поля обязательны, валидация на клиенте перед submit'ом;
- Не-required поля можно опустить.

`CredentialField` подкомпонент с иконкой `Eye/EyeOff` для toggle visibility секретных полей (`apiToken/apiKey/statToken`). `autoComplete="new-password"` для всех — браузер не пытается заполнять старыми значениями.

**5. Server error mapping**

Универсальный `mapServerError(err, fallback)` маппит коды backend в локализованные сообщения:
- `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE`, `ACCOUNT_LABEL_ALREADY_EXISTS`,
- `CREDENTIALS_MISSING_FIELDS/UNKNOWN_FIELDS/FIELD_INVALID_TYPE/EMPTY/TOO_LONG`,
- `MARKETPLACE_NOT_SUPPORTED`,
- `ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE`, `TENANT_WRITE_BLOCKED` → fallback с локализованным `externalHint/writeHint`,
- `ACCOUNT_NOT_FOUND/INACTIVE/HAS_NO_CREDENTIALS/ALREADY_INACTIVE/ALREADY_ACTIVE`,
- `LABEL_REQUIRED`, `UPDATE_EMPTY`.

Никаких сырых `BadRequestException` или HTTP-кодов наружу.

**6. Single-active UX**

`wbExistsActive`/`ozonExistsActive` через `useMemo` определяют наличие active аккаунта. Кнопка quick-add для marketplace с уже active connection становится disabled с явным tooltip «Активный {Wildberries|Ozon}-аккаунт уже есть. Отключите его прежде чем создавать новый». Это **превентивное** UX — backend всё равно вернёт 409 `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE`, но пользователь видит блокировку до клика.

**7. Регистрация**

- [App.tsx](apps/web/src/App.tsx): новый роут `/app/integrations` под `<MainLayout>`.
- [MainLayout.tsx](apps/web/src/layouts/MainLayout.tsx): `NavLink` «Подключения» с иконкой `Plug` в desktop sidebar.

Старая страница `Settings.tsx` (legacy flat-form) намеренно НЕ удалена — она продолжает работать как simpler-UX для пользователей, не дошедших до canonical API. Удаление будет частью переключения sync.service на encrypted credential storage (отдельная задача после TASK_7).

### Проверки

- `npx tsc --noEmit` (apps/web) → `EXIT=0`.
- `npx vite build` → `built in 5.83s`. Pre-existing warning о chunk size не связан.
- Manual UX flow продуман: quick-add (disabled при naличии active), edit modal с masked preview и partial update, validate/deactivate/reactivate с правильной блокировкой per state, diagnostics panel с 4 слоями.

### Соответствие критериям закрытия

- **Пользователь понимает, account неактивен из-за credentials, sync health или tenant policy**: `effectiveRuntimeState` бейдж в шапке + `EFFECTIVE_HINT` параграф + 3 status-cards с error fields отвечают на эти вопросы 1-в-1. Tenant pause фиксируется отдельной amber-карточкой.
- **UI не показывает запрещённые action buttons**: все кнопки disabled с `Lock` иконкой и tooltip-объяснением; quick-add заблокирован при active conflict; edit-modal валидирует client-side ДО submit'а; mapServerError даёт локализованные ответы.
- **Reconnect/edit flows не требуют повторного ввода всех secret-полей без необходимости**: edit modal показывает masked preview (`apiToken: ***7890`), все поля credentials пустые с placeholder `«Не менять»`, в PATCH попадают только тронутые поля (`formSecretsTouched` map).

### Что осталось вне scope

- Удаление legacy `Settings.tsx` flat-form и переключение всех потребителей на canonical API — отдельная задача после TASK_7 и переключения sync.service.
- Push-уведомления при `sync_error_detected` или `validation_failed` — отдельный модуль `12-notifications`.
- Multi-language (i18n) обработка hint-текстов — out of MVP.
- Bulk operations (validate all / sync all) — UI пока per-account, batch endpoint появится при необходимости.
