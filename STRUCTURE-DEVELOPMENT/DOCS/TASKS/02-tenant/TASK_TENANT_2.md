# TASK_TENANT_2 — Create Tenant, Settings Bootstrap и Owner Membership

> Модуль: `02-tenant`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TENANT_1`
  - готов auth context из `01-auth`
- Что нужно сделать:
  - реализовать `POST /tenants`;
  - валидировать `name`, `inn`, `tax_system`, `country`, `currency`, `timezone`;
  - в одной транзакции создавать tenant, settings и owner membership;
  - выставлять `TRIAL_ACTIVE` как стартовый access state;
  - обновлять `last_used_tenant_id` и писать audit/access-state event.
- Критерий закрытия:
  - пользователь без компании может создать tenant и получить рабочий контекст;
  - ИНН проверяется и защищен от дублей;
  - bootstrap после создания согласован с `auth/onboarding`.

---

**Что сделано (2026-04-26)**

Создан модуль `apps/api/src/modules/tenants/` с нуля (ранее директория существовала, но была пустой).

### Файлы

**`dto/create-tenant.dto.ts`**

Валидация через `class-validator`:
- `name` — 2–255 символов, обязательно
- `inn` — 10 или 12 цифр (Regex: `/^\d{10}(\d{2})?$/`), обязательно
- `taxSystem` — `IsIn(['USN_6', 'USN_15', 'OSNO', 'NPD'])`
- `country` — whitelist: RU, BY, KZ, UZ, AM, GE
- `currency` — whitelist: RUB, BYN, KZT, UZS, AMD, GEL, USD, EUR
- `timezone` — whitelist ~14 IANA зон
- `legalName` — опционально, до 255 символов

**`tenant.service.ts`**

- `createTenant(userId, dto)`:
  - Проверяет уникальность ИНН → `TENANT_INN_ALREADY_EXISTS` при конфликте
  - В одной `$transaction` создаёт: `Tenant` + nested `TenantSettings` + `Membership(role=OWNER)` + `TenantAccessStateEvent(toState=TRIAL_ACTIVE, reasonCode=TENANT_CREATED, actorType=USER)`
  - `accessState` выставляется `TRIAL_ACTIVE`
  - `primaryOwnerUserId` устанавливается сразу
  - Upsert `UserPreference.lastUsedTenantId` — новый тенант становится активным
  - Возвращает `{ tenantId, name, accessState, activeTenantSelected: true }`
  - Эмитирует audit event `tenant_created`

- `listTenants(userId)` — все тенанты пользователя через memberships, включает settings

- `getCurrentTenant(userId)` — тенант по `lastUsedTenantId` из UserPreference; null если не выбран

- `getTenant(userId, tenantId)` — карточка тенанта с проверкой membership; `TENANT_NOT_FOUND` если нет доступа

- `switchTenant(userId, tenantId)`:
  - Проверяет наличие membership
  - Блокирует switch в `CLOSED` тенант (`TENANT_CLOSED`)
  - Upsert `UserPreference.lastUsedTenantId`
  - Эмитирует `tenant_selected_as_active`

**`tenant.controller.ts`**

| Метод | Путь | Обработчик |
|---|---|---|
| `POST` | `/tenants` | `createTenant` |
| `GET` | `/tenants` | `listTenants` |
| `GET` | `/tenants/current` | `getCurrentTenant` |
| `GET` | `/tenants/:tenantId` | `getTenant` |
| `POST` | `/tenants/:tenantId/switch` | `switchTenant` |

Все endpoints защищены глобальным `JwtAuthGuard` (не помечены `@Public()`).

**`tenant.module.ts`** — зарегистрирован и подключён в `AppModule`.

### Верификация

- `tsc --noEmit` → 0 ошибок
