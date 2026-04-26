# TASK_ONBOARDING_3 — Bootstrap-to-Tenant Handoff после Создания Компании

> Модуль: `04-onboarding`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_ONBOARDING_1`
  - `TASK_ONBOARDING_2`
  - согласованы `01-auth` и `02-tenant`
- Что нужно сделать:
  - после login без tenant создавать или читать `user_bootstrap` onboarding state;
  - вести `setup_company` как рекомендуемый стартовый шаг, но не обязательный;
  - после создания tenant мигрировать или связывать прогресс с `tenant_activation` state;
  - не терять `viewed/skipped/done` историю при handoff;
  - согласовать handoff с post-login routing и tenant bootstrap.
- Критерий закрытия:
  - первый пользовательский вход без tenant не теряет onboarding контекст;
  - создание компании мягко переводит onboarding в tenant-scoped режим;
  - рекомендательный характер `setup_company` сохранен.

**Что сделано**

Реализация была найдена уже полностью присутствующей в коде (выполнена в рамках T4-01/T4-02). Задача верифицирована и закрыта 2026-04-26.

### Детали реализации

**1. Инициализация USER_BOOTSTRAP при верификации email**

`AuthService.verifyEmail()` (`apps/api/src/modules/auth/auth.service.ts`, строка 152) вызывает `onboardingService.initUserBootstrap(userId)` сразу после подтверждения email — fire-and-forget паттерн, не блокирует ответ. Ошибка логируется через `logger.warn` с событием `onboarding_bootstrap_init_failed`.

**2. Bootstrap-to-Tenant Handoff при создании компании**

`TenantService.createTenant()` (`apps/api/src/modules/tenants/tenant.service.ts`, строки 79–89) вызывает приватный метод `handleTenantCreatedOnboarding(userId, tenantId)` после успешного создания tenant — также fire-and-forget с логированием ошибок (`onboarding_handoff_failed`).

Метод `handleTenantCreatedOnboarding` (строки 350–353) выполняет два действия последовательно:
1. `onboardingService.initTenantActivation(tenantId)` — создаёт TENANT_ACTIVATION state для нового tenant
2. `onboardingService.markStepDone('USER_BOOTSTRAP', userId, 'setup_company', 'domain_event')` — помечает шаг `setup_company` как DONE по domain event

**3. Автозавершение USER_BOOTSTRAP**

В `OnboardingService.markStepDone()` (`apps/api/src/modules/onboarding/onboarding.service.ts`, строки 311–320) при пометке `setup_company → DONE` для scope `USER_BOOTSTRAP` state автоматически переводится в `COMPLETED`. История шагов (`viewed/skipped/done`) не удаляется — записи обновляются на месте.

**4. Идемпотентность**

Оба метода `initUserBootstrap` и `initTenantActivation` защищены от race condition: при конфликте уникального индекса (Prisma error P2002) происходит повторная выборка существующей записи.

**5. Модульная интеграция**

`OnboardingModule` экспортирует `OnboardingService` и подключён как зависимость в `AuthModule` и `TenantModule` через `imports` — DI работает корректно.

**6. Post-login routing**

`AuthService.getMe()` возвращает `nextRoute: '/onboarding'` если у пользователя нет активных memberships, и `nextRoute: '/app'` после создания tenant — переключение происходит автоматически при следующем вызове `/auth/me`.

### Критерии закрытия — статус

- ✅ Первый вход без tenant не теряет onboarding контекст — USER_BOOTSTRAP создаётся при verifyEmail
- ✅ Создание компании мягко переводит onboarding в tenant-scoped режим — handoff через handleTenantCreatedOnboarding
- ✅ Рекомендательный характер `setup_company` сохранён — шаг имеет `required: false` в каталоге
