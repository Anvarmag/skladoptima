# TASK_MARKETPLACE_ACCOUNTS_8 — Dual-token WB: операционный + аналитический токен

> Модуль: `08-marketplace-accounts`
> Статус: [ ] Не начат
> Приоритет: `P1`
> Оценка: `6h`
> Зависимости: `TASK_MARKETPLACE_ACCOUNTS_1`, `TASK_MARKETPLACE_ACCOUNTS_2`

---

## Контекст

WB разрешает создавать токены с разными наборами прав. Сейчас в системе:
- `apiToken` — обязательный, используется для ВСЕХ операций: остатки, заказы, карточки, статистика
- `statToken` — опциональный, задумывался для статистики, но sync.service использует `apiToken` везде

**Проблема:** пользователю приходится создавать один токен с максимальными правами (Маркетплейс r/w + Статистика + Контент), тогда как по принципу минимальных привилегий должно быть два токена:
- **Операционный**: только Маркетплейс (чтение и запись) — управляет остатками FBS
- **Аналитический**: Статистика + Контент (только чтение) — тянет FBO, карточки, финансы

## Что нужно сделать

### Backend — `credential-schema.ts`
- [ ] Переименовать `statToken` → `analyticsToken` в схеме WB
- [ ] Обновить `SECRET_FIELDS.WB`: убрать `statToken`, добавить `analyticsToken`
- [ ] Обновить комментарий схемы:
  ```
  WB: apiToken (Маркетплейс r/w), analyticsToken (Статистика+Контент ro), warehouseId
  ```

### Backend — `sync.service.ts`
- [ ] Выделить хелпер `getWbHeaders(settings, scope: 'operations' | 'analytics')`:
  - `operations` → `Authorization: settings.apiToken`
  - `analytics` → `Authorization: settings.analyticsToken ?? settings.apiToken` (fallback)
- [ ] Заменить прямые `headers: { Authorization: settings.wbApiKey }` на вызов хелпера:
  - `statistics-api.wildberries.ru` → scope `analytics`
  - `content-api.wildberries.ru` → scope `analytics`
  - `marketplace-api.wildberries.ru` → scope `operations`

### Frontend — `MarketplaceAccounts.tsx`
- [ ] Обновить `FIELD_META` для WB: заменить `statToken` на `analyticsToken`
- [ ] В форме создания WB разделить поля на две секции:
  ```
  ── Операционный токен ──────────────────────
  apiToken *     [Маркетплейс: чтение и запись]
  warehouseId *

  ── Аналитический токен (необязательно) ─────
  analyticsToken [Статистика + Контент: только чтение]
                 Без него FBO и карточки товаров не загружаются
  ```
- [ ] Обновить инструкцию в баннере создания WB

### Frontend — `MarketplaceAccounts.tsx` — `isSecretField`
- [ ] Добавить `analyticsToken` в список секретных полей: `k === 'analyticsToken'`

### Backend — `marketplace-accounts.service.ts` — `_buildMaskedPreview`
- [ ] Убедиться что `analyticsToken` маскируется как секрет (SECRET_FIELDS уже обновлён)

## Критерий готовности

- [ ] Пользователь видит два отдельных раздела в форме создания WB-подключения
- [ ] `apiToken` используется только для операций с `marketplace-api.wildberries.ru`
- [ ] `analyticsToken` (если задан) используется для `statistics-api` и `content-api`
- [ ] Если `analyticsToken` не задан — fallback на `apiToken` (обратная совместимость)
- [ ] `statToken` — deprecated, старые credentials с `statToken` продолжают работать через fallback
- [ ] `npx tsc --noEmit` — без ошибок

## История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-05-03 | Задача создана | Анвар |
