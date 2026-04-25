# Codebase Concerns

**Analysis Date:** 2026-04-25

## Security Considerations

**JWT fallback secret хардкодирован:**
- Risk: Если `JWT_SECRET` env не задан, используется `'super-secret-key-change-me'`
- File: `apps/api/src/modules/auth/jwt.strategy.ts:21`
- Current mitigation: Нет
- Recommendations: Добавить `ConfigService` validation — падать при старте если `JWT_SECRET` не задан

**API-ключи маркетплейсов возвращаются в plain text:**
- Risk: `GET /settings/marketplaces` возвращает `wbApiKey`, `ozonApiKey` в ответе
- File: `apps/api/src/modules/marketplace_accounts/` (settings endpoint)
- Current mitigation: Эндпоинт защищён JWT-аутентификацией
- Recommendations: Маскировать ключи в ответе (`sk_****...last4`), хранить зашифрованными в БД

**Admin-пароль логируется при старте:**
- Risk: Plaintext пароль выводится в логи при каждом запуске через `seedAdmin()`
- File: `apps/api/src/modules/users/user.service.ts:52`
- Current mitigation: Нет
- Recommendations: Убрать логирование пароля, логировать только email

**Нет RBAC-enforcement:**
- Risk: Все аутентифицированные пользователи имеют одинаковые права независимо от `Membership.role`
- Files: Все контроллеры — нет `@Roles()` декоратора или RolesGuard
- Current mitigation: Нет
- Recommendations: Реализовать `RolesGuard` + `@Roles(Role.Owner)` для admin-операций (per requirements 03-team)

**Нет валидации типов файлов при загрузке:**
- Risk: Можно загрузить любой файл, включая исполняемые
- File: `apps/api/src/modules/catalog/` (upload endpoint с `multer`)
- Current mitigation: Нет
- Recommendations: Добавить `fileFilter` в multer — разрешать только `image/*`

**Telegram auth_date не проверяется:**
- Risk: Telegram WebApp initData может быть переиспользована после истечения срока
- File: `apps/api/src/modules/auth/auth.service.ts` (Telegram validate)
- Current mitigation: HMAC-SHA256 подпись проверяется
- Recommendations: Добавить проверку `auth_date` (max 24 часа от текущего времени)

---

## Tech Debt

**God object `sync.service.ts`:**
- Issue: ~1280 строк — один файл обрабатывает весь WB + Ozon цикл (pull, push, orders, finance, history)
- File: `apps/api/src/modules/marketplace_sync/sync.service.ts`
- Impact: Сложно тестировать, изменять, добавлять новые маркетплейсы
- Fix approach: Разбить на `WbSyncService`, `OzonSyncService`, `SyncOrchestrator`

**50+ использований `any`:**
- Issue: `@typescript-eslint/no-explicit-any: off` — `any` используется в контроллерах и сервисах
- Files: Все контроллеры (`req: any`), большинство сервисов
- Impact: Нет type safety на границе HTTP
- Fix approach: Заменить `req: any` на `@Req() req: RequestWithUser` с типизированным интерфейсом

**`$executeRawUnsafe` для обновления остатков:**
- Issue: Прямые SQL-запросы через `$executeRawUnsafe` для bulk stock updates
- File: `apps/api/src/modules/marketplace_sync/sync.service.ts`
- Impact: Обходит ORM-слой, сложно рефакторить схему
- Fix approach: Использовать `prisma.product.updateMany()` или Prisma batch operations

**In-memory cooldown map теряется при перезапуске:**
- Issue: `private lastPush = new Map<string, { wb?: number, ozon?: number }>()` — хранится в памяти
- File: `apps/api/src/modules/marketplace_sync/sync.service.ts`
- Impact: После деплоя/рестарта ping-pong protection не работает до следующего цикла
- Fix approach: Перенести cooldown в Redis или отдельную таблицу БД

**`pullHistoryFromWb` заглушка:**
- Issue: Метод вызывает `processWbOrders` вместо реальной истории продаж
- File: `apps/api/src/modules/marketplace_sync/sync.service.ts`
- Impact: История WB не загружается корректно

**`finance.importMarketplaceReport` заглушка:**
- Issue: Метод возвращает `{ count: 0 }` — не реализован
- File: `apps/api/src/modules/finance/finance.service.ts`
- Impact: Импорт финансовых отчётов маркетплейсов не работает

---

## Performance Bottlenecks

**N×2 запросов в AnalyticsService и FinanceService:**
- Problem: `calculateUnitEconomics` делает отдельный запрос на каждый продукт (N+1 паттерн)
- Files: `apps/api/src/modules/analytics/analytics.service.ts`, `apps/api/src/modules/finance/finance.service.ts`
- Measurement: ~200 DB-запросов на загрузку страницы при 100 товарах
- Improvement path: Batch-запросы через `prisma.product.findMany()` + `.reduce()` в памяти

**N+1 в `importFromWb` / `importProductsFromOzon`:**
- Problem: `findFirst` на каждый товар внутри цикла при синхронизации
- File: `apps/api/src/modules/marketplace_sync/sync.service.ts`
- Improvement path: Предзагрузить все SKU тенанта одним запросом, использовать Map для lookup

**Отсутствие пагинации в Ozon stock pull:**
- Problem: Запрос остатков Ozon без loop — молча теряет товары после 1000-й позиции
- File: `apps/api/src/modules/marketplace_sync/sync.service.ts` (Ozon FBS pull)
- Improvement path: Добавить пагинацию по `last_id` согласно Ozon API docs

---

## Fragile Areas

**Ping-pong protection (SyncService):**
- Why fragile: In-memory Map сбрасывается при каждом перезапуске; нет интеграционных тестов
- Common failures: Бесконечный цикл push-pull между нашей системой и маркетплейсом после деплоя
- Safe modification: Не изменять логику cooldown без миграции хранилища на persistent storage

**Multi-tenancy enforcement:**
- Why fragile: Нет central middleware — каждый сервис вручную добавляет `where: { tenantId }`. Легко пропустить в новом методе
- Common failures: Data leak между тенантами при добавлении нового эндпоинта без `tenantId` фильтра
- Safe modification: Всегда проверять что Prisma-запросы включают `tenantId` в `where`

**Prisma $transaction в `registerUser`:**
- Why fragile: Создаёт Tenant → User → Membership в одной транзакции; ошибка в любом шаге откатывает всё
- Common failures: Уникальное нарушение email + несинхронизированное состояние если транзакция частично выполнена до ошибки
- Test coverage: Нет тестов

---

## Missing Features (Business Requirements vs Implementation)

| Требование | Модуль | Статус |
|-----------|--------|--------|
| RBAC / enforcement ролей | 03-team | Отсутствует — роли есть в БД, нет enforcement |
| Invite-система для команды | 03-team | Отсутствует |
| Онбординг-флоу | 04-onboarding | Отсутствует |
| Модель складов | 07-warehouses | Отсутствует |
| История / статус sync-задач | 09-sync (FR-03) | Отсутствует |
| S3-хранилище файлов | 17-files-s3 | Отсутствует (используется local uploads/) |
| Worker queue с retry/DLQ | 18-worker | Отсутствует (простой polling loop) |
| Billing / подписки | 13-billing | Отсутствует |
| Реферальная программа | 14-referrals | Отсутствует |
| Admin панель | 19-admin | Отсутствует |
| Финансовый импорт отчётов | 11-finance | Заглушка (возвращает `{ count: 0 }`) |
| История продаж WB | 09-sync | Заглушка (`pullHistoryFromWb`) |

---

## Test Coverage Gaps

**Нулевое покрытие бизнес-логики:**
- Существует: 1 unit-тест "Hello World" + 1 e2e-тест `GET /`
- Не покрыто: ProductService, AuthService, SyncService, FinanceService, AnalyticsService, UserService
- Risk: Любая регрессия будет обнаружена только в проде

**Нет тестов tenant isolation:**
- Risk: Data leak между тенантами при рефакторинге
- Priority: High

**Нет тестов order idempotency:**
- Risk: Дублирование заказов при повторной синхронизации
- Priority: High

**Нет frontend тестов:**
- `apps/web` — нет vitest/jest конфига, нет тест-файлов
- Priority: Medium

---

## Dependencies at Risk

**Local file storage (multer + Docker volume):**
- Risk: Не масштабируется горизонтально; потеря файлов при пересоздании контейнера без volume
- Impact: Фото товаров недоступны при деплое без правильно настроенного volume
- Migration plan: S3-совместимое хранилище (per requirements 17-files-s3)

---

*Concerns audit: 2026-04-25*
*Update as issues are fixed or new ones discovered*
