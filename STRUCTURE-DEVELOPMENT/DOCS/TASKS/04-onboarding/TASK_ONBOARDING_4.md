# TASK_ONBOARDING_4 — Step Catalog, Domain Events и Auto-Complete

> Модуль: `04-onboarding`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ONBOARDING_1`
  - `TASK_ONBOARDING_2`
  - согласованы `08-marketplace-accounts`, `09-sync`
- Что нужно сделать:
  - каталог шагов v1 зафиксирован в T4-01 (`welcome`, `setup_company`, `connect_marketplace`, `add_products`, `invite_team`, `check_stocks`); для v2+ — добавлять версию в `step-catalog.ts`;
  - реализовать source-aware step updates: `user_action`, `domain_event`, `migration`;
  - настроить автозавершение шагов по domain events из таблицы аналитики: `tenant_created` → `setup_company` DONE, `marketplace_account_connected` → `connect_marketplace` DONE, `first_product_created` → `add_products` DONE, `first_invite_sent` → `invite_team` DONE;
  - экспортировать `markStepDone(scope, scopeId, stepKey, source)` из `OnboardingService` для вызова из доменных сервисов (`TenantService`, `TeamService`, `MarketplaceService`, `CatalogService`);
  - завести event tracking `opened/step_viewed/skipped/completed`.
- Критерий закрытия:
  - шаги живут по фиксированному каталогу;
  - auto-complete работает по факту действия, а не только по кнопке;
  - completion metric не искажается смешением обязательных и рекомендательных шагов.

**Что сделано**

Реализована интеграция domain events для трёх недостающих шагов онбординга. Завершена 2026-04-26.

### Что было до начала задачи

`markStepDone(scope, scopeId, stepKey, source)` уже был реализован в `OnboardingService` (T4-01/T4-02) и вызывался только из `TenantService.createTenant()` для шага `setup_company`. Три шага (`invite_team`, `connect_marketplace`, `add_products`) не имели интеграции.

### Изменения в коде

**1. TeamService → `invite_team`**

- `apps/api/src/modules/team/team.module.ts` — добавлен импорт `OnboardingModule`
- `apps/api/src/modules/team/team.service.ts` — инжектирован `OnboardingService`; в конце `createInvitation()` добавлен fire-and-forget вызов `markStepDone('TENANT_ACTIVATION', tenantId, 'invite_team', 'domain_event')`

Триггер — момент отправки инвайта (`createInvitation`), не принятия. Соответствует domain event `first_invite_sent` из аналитики.

**2. SettingsService → `connect_marketplace`**

- `apps/api/src/modules/marketplace/settings.module.ts` — добавлен импорт `OnboardingModule`
- `apps/api/src/modules/marketplace/settings.service.ts` — добавлены `Logger` и `OnboardingService`; в `updateSettings()` введён флаг `didUpdate` — если хотя бы одна ветка (WB или Ozon) обновилась, в конце метода запускается fire-and-forget `markStepDone('TENANT_ACTIVATION', tenantId, 'connect_marketplace', 'domain_event')`. Флаг предотвращает двойной вызов при одновременном обновлении обоих маркетплейсов.

**3. ProductService → `add_products`**

- `apps/api/src/modules/catalog/product.module.ts` — добавлен импорт `OnboardingModule`
- `apps/api/src/modules/catalog/product.service.ts` — добавлены `Logger` и `OnboardingService`; fire-and-forget `markStepDone('TENANT_ACTIVATION', tenantId, 'add_products', 'domain_event')` добавлен в оба пути метода `create()`: создание нового продукта и восстановление soft-deleted продукта.

### Паттерн интеграции

Во всех трёх местах используется единый паттерн, аналогичный `TenantService`:
- Fire-and-forget (не блокирует основной ответ)
- Ошибка логируется через `logger.warn` с событием `onboarding_step_update_failed`
- `markStepDone` идемпотентен — повторный вызов на уже `DONE` шаге является no-op

### Критерии закрытия — статус

- ✅ Шаги живут по фиксированному каталогу v1 (`step-catalog.ts`)
- ✅ Auto-complete работает по факту действия: инвайт → `invite_team`, настройка маркетплейса → `connect_marketplace`, создание товара → `add_products`, создание компании → `setup_company`
- ✅ Source-aware updates: все domain event вызовы передают `source: 'domain_event'`, пользовательские действия — `'user_action'`
- ✅ TypeScript компиляция без ошибок (`tsc --noEmit`)
