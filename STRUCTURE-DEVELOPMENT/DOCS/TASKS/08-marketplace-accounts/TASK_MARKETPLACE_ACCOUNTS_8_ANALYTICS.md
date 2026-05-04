# TASK_MARKETPLACE_ACCOUNTS_8 — Системная аналитика: Dual-token WB

> Статус: [ ] В работе
> Создано: 2026-05-03
> Задача: `TASK_MARKETPLACE_ACCOUNTS_8`
> Зависимости задачи: `TASK_MARKETPLACE_ACCOUNTS_1`, `TASK_MARKETPLACE_ACCOUNTS_2`
> Связанные разделы: `08-marketplace-accounts` (system-analytics.md §13), `09-sync`, `FR-30` в requirements.md

---

## 1. Назначение и цель

Задача вводит разделение WB-credentials на два независимых токена с разными уровнями доступа. Это закрывает бизнес-требование `FR-30` и бизнес-правило `BR-04` из requirements.md раздела `08-marketplace-accounts`.

### Проблема (as-is)

`sync.service.ts` использует единственный токен `wbApiKey` (он же `apiToken` в `credential-schema.ts`) для **всех** WB-endpoint'ов:

| Endpoint | Назначение | Требуемые права WB |
|----------|-----------|-------------------|
| `marketplace-api.wildberries.ru` | FBS остатки, заказы | Маркетплейс (чтение и запись) |
| `statistics-api.wildberries.ru` | FBO остатки (`/api/v1/supplier/stocks`) | Статистика (только чтение) |
| `content-api.wildberries.ru` | Карточки товаров (`/content/v2/get/cards/list`) | Контент (только чтение) |

Поле `statToken` / `wbStatApiKey` существует в credential-schema и `getSettings()`, но **никогда не используется** в реальных HTTP-вызовах (везде идёт `settings.wbApiKey`). Пользователь вынужден создавать один WB-токен с тремя группами прав одновременно, что нарушает принцип минимальных привилегий.

### Цель (to-be)

- `apiToken` — **операционный**: только права «Маркетплейс (чтение и запись)», используется исключительно для `marketplace-api.wildberries.ru`.
- `analyticsToken` — **аналитический**: права «Статистика + Контент (только чтение)», используется для `statistics-api` и `content-api`.
- Если `analyticsToken` не задан — **fallback на `apiToken`** для обеспечения обратной совместимости.
- `statToken` считается deprecated: существующие credentials с `statToken` продолжают работать через alias-fallback.

---

## 2. Функциональный контур и границы

### Что входит в задачу

- Переименование `statToken` → `analyticsToken` в `credential-schema.ts` (SCHEMAS, SECRET_FIELDS).
- Добавление хелпера `getWbHeaders(settings, scope)` в `sync.service.ts`.
- Замена прямых обращений `headers: { Authorization: settings.wbApiKey }` на вызов хелпера по scope.
- Обновление FIELD_META и формы в `MarketplaceAccounts.tsx`: визуальное разделение на два раздела.
- Добавление `analyticsToken` в проверку `isSecretField` на фронтенде.
- Проверка маскирования `analyticsToken` в `_buildMaskedPreview`.

### Что не входит в задачу

- Подтягивание финансовых данных WB (`/api/v5/supplier/reportDetailByPeriod`) — это `FR-31` / `TASK_ANALYTICS_8`.
- Реальный UI ротации или раздельной ревалидации токенов.
- Изменение модели данных `MarketplaceCredential` — хранение по-прежнему в едином `encryptedPayload`.
- Изменение policy-уровня (`TenantAccessState`, preflight) — оба токена живут внутри одного account.
- Добавление Yandex Market dual-token.

---

## 3. Акторы и зоны ответственности

| Актор | Что меняется |
|-------|-------------|
| Owner/Admin | Видит два раздела в форме создания WB — операционный и аналитический токен |
| Frontend (MarketplaceAccounts.tsx) | Рендерит секционированную форму, добавляет `analyticsToken` в masked field list |
| credential-schema.ts | Определяет допустимые поля и секретные поля для WB |
| sync.service.ts | Выбирает правильный токен по scope перед каждым HTTP-вызовом к WB |
| marketplace-accounts.service.ts / CredentialsCipher | Маскирует `analyticsToken` как секрет, шифрует вместе с остальными полями |

---

## 4. Базовые сценарии использования

### Сценарий 1. Пользователь создаёт WB-подключение с двумя токенами

1. Форма показывает два раздела: «Операционный токен» и «Аналитический токен (необязательно)».
2. Пользователь вводит `apiToken` + `warehouseId` (обязательно) и `analyticsToken` (опционально).
3. Backend: `credential-schema.ts` принимает `analyticsToken` как optional в SCHEMAS.WB.
4. `CredentialsCipher` шифрует оба токена в единый `encryptedPayload`.
5. `_buildMaskedPreview` маскирует `analyticsToken` через `SECRET_FIELDS.WB`.
6. При первом sync: `getWbHeaders(decrypted, 'analytics')` вернёт `analyticsToken`, если задан; иначе — `apiToken`.

### Сценарий 2. Пользователь создаёт WB-подключение без аналитического токена (legacy / minimal)

1. Форма: только `apiToken` + `warehouseId`.
2. Credentials сохраняются без `analyticsToken`.
3. При sync: `getWbHeaders(decrypted, 'analytics')` → fallback на `apiToken`.
4. FBO, карточки загружаются (с одним токеном-мастером), но с ограниченными правами.
5. UI показывает предупреждение: «Без аналитического токена FBO и карточки товаров не загружаются».

### Сценарий 3. Существующий WB-account со старым полем `statToken`

1. В `encryptedPayload` хранится `{ apiToken, statToken, warehouseId }`.
2. `getWbHeaders(decrypted, 'analytics')` проверяет `analyticsToken ?? statToken ?? apiToken`.
3. Fallback-цепочка обеспечивает обратную совместимость без миграции данных.
4. В следующем PATCH пользователь может добавить `analyticsToken`; `statToken` удаляется из payload через `CREDENTIALS_UNKNOWN_FIELDS` только если сервер переводит схему на strict-mode (не в данной задаче).

### Сценарий 4. Обновление токенов (PATCH credentials)

1. Пользователь меняет только `analyticsToken`.
2. `validateCredentialsForPartialUpdate` принимает partial payload.
3. После merge с existing: `apiToken` и `warehouseId` сохраняются.
4. Только обновлённое поле появляется в `CREDENTIALS_ROTATED.fieldsRotated`.
5. `credentialStatus → VALIDATING` — запускается re-validate.

---

## 5. Зависимости и интеграции

| Модуль / файл | Тип зависимости | Комментарий |
|---------------|-----------------|-------------|
| `TASK_MARKETPLACE_ACCOUNTS_1` | Данные | Схема `MarketplaceCredential.encryptedPayload` — хранит оба токена в одном поле |
| `TASK_MARKETPLACE_ACCOUNTS_2` | Данные + сервисы | `CredentialsCipher`, `SECRET_FIELDS`, `_buildMaskedPreview`, `credential-schema.ts` — всё меняется здесь |
| `sync.service.ts` | Поведение | Читает decrypted credentials через `getSettings()` — добавляем `wbAnalyticsKey` |
| `MarketplaceAccounts.tsx` | UI | Форма WB — новые поля и секции |
| `requirements.md §FR-30` | Требования | Прямое соответствие |
| `requirements.md §FR-31` | Зависит от нас | `TASK_ANALYTICS_8` использует `analyticsToken` для финансового API WB — мы должны завести поле раньше |

---

## 6. Изменения credential-schema.ts

### 6.1. SCHEMAS.WB — до / после

```typescript
// До
WB: {
    required: ['apiToken', 'warehouseId'],
    optional: ['statToken'],                  // <-- deprecated
}

// После
WB: {
    required: ['apiToken', 'warehouseId'],
    optional: ['analyticsToken'],             // <-- переименовано
}
```

### 6.2. SECRET_FIELDS.WB — до / после

```typescript
// До
WB: new Set(['apiToken', 'statToken'])

// После
WB: new Set(['apiToken', 'analyticsToken'])
```

### 6.3. Комментарий схемы

```typescript
/**
 * WB: apiToken (Маркетплейс r/w), analyticsToken (Статистика+Контент ro), warehouseId
 * OZON: clientId, apiKey, warehouseId
 */
```

### 6.4. Обратная совместимость для `statToken`

`validateCredentialsForPartialUpdate` НЕ должна отклонять credentials с `statToken` на PATCH до явного moment устаревания. Возможны два подхода:

| Подход | Плюсы | Минусы |
|--------|-------|--------|
| **A. Добавить `statToken` в optional как deprecated-alias** | Старые PATCH не падают | Схема содержит мусор |
| **B. Отклонять `statToken` с кодом `CREDENTIALS_FIELD_DEPRECATED`** | Чистая схема | Breaking change для старых clients |
| **C. Молча игнорировать `statToken` в partial update (strip)** | Backward compat + чистота | Пользователь не знает что поле проигнорировано |

**Решение для MVP (TASK_8)**: Подход **A** — добавить `statToken` в optional с аннотацией `@deprecated`. Это позволяет старым записям в `encryptedPayload` не ломаться при re-encrypt. Полное удаление — отдельная задача зачистки.

---

## 7. Алгоритм маршрутизации токенов (sync.service.ts)

### 7.1. Хелпер `getWbHeaders`

```typescript
// Концептуальная реализация
function getWbHeaders(
    settings: { wbApiKey?: string; wbAnalyticsKey?: string },
    scope: 'operations' | 'analytics',
): { Authorization: string } {
    if (scope === 'operations') {
        return { Authorization: settings.wbApiKey! };
    }
    // analytics: предпочитаем analyticsToken, fallback на apiToken
    return { Authorization: settings.wbAnalyticsKey ?? settings.wbApiKey! };
}
```

### 7.2. Маршрутизация по endpoint

| Endpoint | Scope | Токен |
|----------|-------|-------|
| `marketplace-api.wildberries.ru/api/v3/stocks/:wh` | `operations` | `apiToken` |
| `marketplace-api.wildberries.ru/api/v3/orders/*` | `operations` | `apiToken` |
| `statistics-api.wildberries.ru/api/v1/supplier/stocks` | `analytics` | `analyticsToken ?? apiToken` |
| `statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod` | `analytics` | `analyticsToken ?? apiToken` |
| `content-api.wildberries.ru/content/v2/get/cards/list` | `analytics` | `analyticsToken ?? apiToken` |

### 7.3. Обновление `getSettings()`

В текущем коде `getSettings()` возвращает `wbStatApiKey: wb?.statApiKey`. Нужно:

```typescript
// До
wbStatApiKey: wb?.statApiKey,

// После — добавить новое поле, читаем из decrypted credentials
wbAnalyticsKey: wb?.decryptedAnalyticsToken,  // из MarketplaceCredential
```

**Важно**: `wbStatApiKey` не используется в sync.service — после добавления `wbAnalyticsKey` поле `wbStatApiKey` можно не возвращать в `getSettings()` (оно уже мёртвое). Удалять его в рамках TASK_8, чтобы не оставлять мусор.

### 7.4. Как получить decrypted credentials в sync.service

Текущий `getSettings()` читает **legacy plaintext поля** (`wb?.apiKey`). После TASK_2 canonical credentials хранятся в `MarketplaceCredential.encryptedPayload`. Sync.service НЕ был переведён на encrypted storage (намеренно отложено).

Для TASK_8 требуется:
- Либо добавить в `getSettings()` чтение через `CredentialsCipher.decrypt(wb.credentials.encryptedPayload)` для WB.
- Либо ввести `SyncCredentialsResolver` — новый dependency для sync.service.

**Рекомендованный подход**: добавить `CredentialsCipher` как dependency в `SyncService` и расширить `getSettings()` расшифровкой — это одна функция, без нарушения архитектуры. Scope: только WB decryption в рамках TASK_8; полный переход sync.service на encrypted storage — отдельная задача.

---

## 8. Frontend UX — MarketplaceAccounts.tsx

### 8.1. Изменения FIELD_META

```typescript
// До
{ key: 'statToken', label: 'Статистический токен', secret: true, required: false }

// После
{ key: 'analyticsToken', label: 'Аналитический токен', secret: true, required: false }
```

### 8.2. Секционированная форма WB

```
┌─────────────────────────────────────────────────────────┐
│  Подключение Wildberries                                │
├─────────────────────────────────────────────────────────┤
│  ── Операционный токен ───────────────────────────────  │
│  apiToken *        [Маркетплейс: чтение и запись]       │
│  warehouseId *                                          │
│                                                         │
│  ── Аналитический токен (необязательно) ──────────────  │
│  analyticsToken    [Статистика + Контент: только чтение]│
│  ⚠ Без него FBO и карточки товаров не загружаются       │
└─────────────────────────────────────────────────────────┘
```

### 8.3. isSecretField

```typescript
// До
k === 'apiToken' || k === 'statToken' || k === 'apiKey'

// После — добавить analyticsToken
k === 'apiToken' || k === 'analyticsToken' || k === 'apiKey'
```

### 8.4. Правила отображения формы

- `apiToken` + `warehouseId` — обязательны, всегда видны в WB-секции.
- `analyticsToken` — опционально, с placeholder и tooltip «Без него FBO и финансовые данные недоступны».
- Edit-режим: `maskedPreview.analyticsToken` показывается как `***xxxx` если задан; если не задан — пустое поле.
- `formSecretsTouched` map должна включать `analyticsToken` — partial PATCH только если поле явно тронуто.

---

## 9. Модель данных — влияние на `marketplace_credentials`

Изменений в схеме БД **нет**. `encryptedPayload` хранит произвольный JSON-объект credentials. После TASK_8 payload WB может содержать:

```json
// Новые записи
{ "apiToken": "...", "analyticsToken": "...", "warehouseId": "..." }

// Legacy записи (statToken → обрабатывается fallback'ом)
{ "apiToken": "...", "statToken": "...", "warehouseId": "..." }

// Минимальные записи (только apiToken)
{ "apiToken": "...", "warehouseId": "..." }
```

`schemaVersion` в `MarketplaceCredential` остаётся `1`. При необходимости явной миграции legacy `statToken → analyticsToken` — отдельная задача с `schemaVersion: 2`.

---

## 10. Обратная совместимость

| Случай | Поведение |
|--------|-----------|
| `analyticsToken` задан | Используется для statistics-api + content-api |
| `analyticsToken` не задан, `statToken` задан | `getWbHeaders('analytics')` → `statToken` (legacy fallback) |
| Ни `analyticsToken`, ни `statToken` не задан | Fallback на `apiToken` |
| PATCH с `statToken` в payload | Принимается (deprecated-alias), сохраняется в encryptedPayload |
| `statToken` в create payload | Отклоняется с `CREDENTIALS_UNKNOWN_FIELDS` (new accounts должны использовать `analyticsToken`) |

**Ключевое правило**: fallback-цепочка разрешена только в `getWbHeaders()`. В credential-schema `statToken` не должен попадать в новые accounts — это deprecated поле только для legacy read.

---

## 11. Валидации и ошибки

| Ситуация | Код ошибки | HTTP |
|----------|-----------|------|
| WB create с `statToken` в credentials | `CREDENTIALS_UNKNOWN_FIELDS` | 400 |
| WB create без `apiToken` | `CREDENTIALS_MISSING_FIELDS` | 400 |
| WB create без `warehouseId` | `CREDENTIALS_MISSING_FIELDS` | 400 |
| PATCH с неизвестным полем | `CREDENTIALS_UNKNOWN_FIELDS` | 400 |
| `analyticsToken` задан, но пустая строка | `CREDENTIALS_FIELD_EMPTY` | 400 |
| `analyticsToken` > 1024 символов | `CREDENTIALS_FIELD_TOO_LONG` | 400 |

### Нет новых ошибок на уровне sync

`getWbHeaders()` — pure function с fallback, не бросает исключений. Если ни один токен не задан — `getSettings()` вернёт null, и `syncBatchToWb` / `pullWbFbo` прервутся на уже существующей проверке `if (!settings?.wbApiKey) return`.

---

## 12. Тестовая матрица

### Backend — credential-schema.ts

- [ ] WB create с `analyticsToken` — принимается как optional.
- [ ] WB create без `analyticsToken` — принимается (optional поле).
- [ ] WB create с `statToken` — отклоняется `CREDENTIALS_UNKNOWN_FIELDS`.
- [ ] WB partial update только `analyticsToken` — принимается.
- [ ] SECRET_FIELDS.WB содержит `analyticsToken`, не содержит `statToken`.
- [ ] `maskedPreview` маскирует `analyticsToken` → `***xxxx`.

### Backend — sync.service.ts (getWbHeaders)

- [ ] scope=`operations` → возвращает `apiToken`.
- [ ] scope=`analytics` с `analyticsToken` → возвращает `analyticsToken`.
- [ ] scope=`analytics` без `analyticsToken`, есть `statToken` → возвращает `statToken`.
- [ ] scope=`analytics` без обоих → возвращает `apiToken` (fallback).
- [ ] `statistics-api` вызов использует `getWbHeaders(settings, 'analytics')`.
- [ ] `content-api` вызов использует `getWbHeaders(settings, 'analytics')`.
- [ ] `marketplace-api` вызов использует `getWbHeaders(settings, 'operations')`.

### Frontend — MarketplaceAccounts.tsx

- [ ] Форма WB отображает два раздела.
- [ ] `analyticsToken` — masked input (Eye/EyeOff toggle).
- [ ] `analyticsToken` в edit-режиме показывает `***xxxx` из maskedPreview.
- [ ] PATCH отправляет `analyticsToken` только если поле тронуто (`formSecretsTouched`).
- [ ] `statToken` не отображается в форме.

### E2E — обратная совместимость

- [ ] Account с legacy `statToken` в encryptedPayload — sync не падает.
- [ ] Account без `analyticsToken` — FBO и metadata sync работают через fallback на `apiToken`.
- [ ] `tsc --noEmit` без ошибок.

---

## 13. Нефункциональные требования

| Область | Требование |
|---------|-----------|
| Безопасность | `analyticsToken` маскируется так же как `apiToken`; не утекает в logs / response |
| Backward compat | Все существующие WB-accounts с любым набором legacy-полей продолжают синхронизацию |
| Производительность | `getWbHeaders()` — O(1), без IO; не влияет на latency sync |
| Расширяемость | scope может быть расширен до `'financial'` для `FR-31` без изменения архитектуры |

---

## 14. Observability и логирование

- При каждом вызове `getWbHeaders('analytics')` логировать какой токен фактически использован (`analyticsToken` vs fallback `apiToken`) — уровень `debug`, без значений токенов.
- Метрика: `wb_sync_analytics_token_fallback_count` — количество вызовов через fallback (сигнал о том, сколько accounts без `analyticsToken`).
- Алерт (P2): если 100% WB-accounts используют fallback при analytics — значит `analyticsToken` никто не заводит, стоит напомнить пользователям.

---

## 15. Риски и архитектурные замечания

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| `getSettings()` возвращает legacy plaintext поля, а не decrypted `analyticsToken` | Высокая | Явно добавить `CredentialsCipher.decrypt()` в `getSettings()` для WB |
| `statToken` в legacy encryptedPayload при re-encrypt через PATCH попадёт в `CREDENTIALS_UNKNOWN_FIELDS` | Средняя | Добавить `statToken` в `optional` как deprecated-alias на время переходного периода |
| Frontend отправляет `statToken` из старого кэша FIELD_META | Низкая | После деплоя PATCH вернёт `CREDENTIALS_UNKNOWN_FIELDS` — это ожидаемое поведение |
| `TASK_ANALYTICS_8` ожидает `analyticsToken` в credentials | Высокая | TASK_8 должна быть завершена раньше TASK_ANALYTICS_8 |
| Пользователь не замечает optional-поле и создаёт account без `analyticsToken` | Средняя | UI показывает предупреждение в форме; hint в masked preview |

---

## 16. Связи с другими задачами и разделами

| Задача / раздел | Связь |
|-----------------|-------|
| `TASK_MARKETPLACE_ACCOUNTS_1` | Заложила `MarketplaceCredential.encryptedPayload` — формат хранения не меняется |
| `TASK_MARKETPLACE_ACCOUNTS_2` | `CredentialsCipher`, `SECRET_FIELDS`, `credential-schema.ts` — все изменяются в TASK_8 |
| `TASK_ANALYTICS_8` | Потребляет `analyticsToken` для `/api/v5/supplier/reportDetailByPeriod` — зависит от TASK_8 |
| `system-analytics.md §13` | Раздел «Поля credentials по маркетплейсам» нужно обновить: `statToken` → `analyticsToken` |
| `09-sync / sync.service.ts` | Прямое изменение поведения `pullWbFbo()` и `syncProductMetadata()` |

---

## 17. Чеклист реализации

- [ ] `credential-schema.ts`: `statToken` → `analyticsToken` в SCHEMAS.WB.optional
- [ ] `credential-schema.ts`: `statToken` добавлен как deprecated-alias в optional (backward compat при PATCH)
- [ ] `credential-schema.ts`: `SECRET_FIELDS.WB` обновлён (`analyticsToken` вместо `statToken`)
- [ ] `credential-schema.ts`: комментарий схемы обновлён
- [ ] `sync.service.ts`: добавлен `CredentialsCipher` как dependency
- [ ] `sync.service.ts`: `getSettings()` возвращает `wbAnalyticsKey` (из decrypted payload)
- [ ] `sync.service.ts`: хелпер `getWbHeaders(settings, scope)` реализован
- [ ] `sync.service.ts`: `pullWbFbo()` использует `getWbHeaders(settings, 'analytics')`
- [ ] `sync.service.ts`: `syncProductMetadata()` WB-ветка использует `getWbHeaders(settings, 'analytics')`
- [ ] `sync.service.ts`: `syncBatchToWb()` использует `getWbHeaders(settings, 'operations')`
- [ ] `sync.service.ts`: мёртвое поле `wbStatApiKey` удалено из `getSettings()`
- [ ] `MarketplaceAccounts.tsx`: FIELD_META WB обновлён (`analyticsToken`)
- [ ] `MarketplaceAccounts.tsx`: форма WB разделена на два section
- [ ] `MarketplaceAccounts.tsx`: `isSecretField` включает `analyticsToken`
- [ ] `marketplace-accounts.service.ts`: проверено что `analyticsToken` маскируется (SECRET_FIELDS уже обновлён)
- [ ] Тесты согласно §12 написаны и проходят
- [ ] `npx tsc --noEmit` — без ошибок

---

## 18. Критерии готовности (DoD)

- Пользователь видит два отдельных раздела в форме создания WB-подключения.
- `apiToken` используется только для `marketplace-api.wildberries.ru`.
- `analyticsToken` (если задан) используется для `statistics-api` и `content-api`.
- Если `analyticsToken` не задан — fallback на `apiToken` без ошибок.
- Все существующие WB-accounts (включая legacy `statToken`) продолжают синхронизацию.
- `analyticsToken` маскируется в API response (`***xxxx`).
- `npx tsc --noEmit` — без ошибок.
- Регрессионный пакет marketplace-accounts — все тесты проходят.

---

## 19. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-05-03 | Документ создан | Claude |
