# External Integrations

**Analysis Date:** 2026-04-25

## Marketplace APIs

### Wildberries (WB)
- **Статус:** Реализовано (packages/api/ + packages/worker/)
- **Endpoints:**
  - `marketplace-api.wildberries.ru` — заказы, остатки
  - `content-api.wildberries.ru` — карточки товаров
  - `statistics-api.wildberries.ru` — аналитика продаж
  - `common-api.wildberries.ru` — справочники
- **Auth:** API-ключ в заголовке `Authorization`
- **Использование:** Синхронизация каталога, заказов, остатков, аналитики

### Ozon Seller API
- **Статус:** Реализовано (packages/api/ + packages/worker/)
- **Base URL:** `api-seller.ozon.ru`
- **Версии:** v2, v3, v4 (зависит от ресурса)
- **Auth:** `Client-Id` + `Api-Key` заголовки
- **Использование:** Синхронизация товаров, заказов, FBO/FBS остатков

## Authentication Providers

### JWT (internal)
- **Статус:** Реализовано
- **Библиотека:** `passport-jwt`, `@nestjs/passport`
- **Transport:** httpOnly cookies (не Authorization header)
- **Refresh:** Refresh-токен в отдельном cookie

### Telegram WebApp
- **Статус:** Реализовано (per requirements 01-auth)
- **Механизм:** HMAC-SHA256 валидация `initData`
- **Использование:** Авторизация через Telegram Mini App
- **Переменная:** `TELEGRAM_BOT_TOKEN`

### MAX Platform (Mail.ru)
- **Статус:** Реализовано / в разработке
- **API:** `platform-api.max.ru`
- **Использование:** Бот-интеграция для уведомлений (per requirements 15-notifications)

## Database

### PostgreSQL 15
- **Статус:** Основная БД
- **ORM:** Prisma 5.21
- **Connection:** `DATABASE_URL` (connection string)
- **Миграции:** `packages/api/prisma/migrations/`
- **Multi-tenancy:** Реализована через `tenantId` поля в моделях

## File Storage

### Local (текущее)
- **Статус:** Временное решение
- **Механизм:** `multer` → Docker volume `uploads/`
- **Ограничение:** Не масштабируется, нет CDN

### S3-совместимое хранилище (планируется)
- **Статус:** Запланировано (requirements 17-files-s3)
- **Применение:** Медиафайлы товаров, документы, аватары
- **Провайдеры:** AWS S3 / Yandex Object Storage / MinIO

## Planned Integrations (per Business Requirements)

### Платёжная система (billing)
- **Требования:** requirements 13-billing
- **Применение:** Подписки, тарифные планы
- **Провайдер:** Не определён (CloudPayments / ЮKassa / Tinkoff)

### Email-сервис (notifications)
- **Требования:** requirements 15-notifications
- **Применение:** Транзакционные письма (регистрация, уведомления)
- **Провайдер:** Не определён (SendGrid / Mailgun / Postmark)

### Push-уведомления
- **Требования:** requirements 15-notifications
- **Применение:** Web push / Telegram bot уведомления

## Webhooks

### Входящие (inbound)
- Маркетплейсы: нет (polling-based синхронизация через worker)
- Планируется: webhook от платёжного провайдера (billing)

### Исходящие (outbound)
- Не реализовано

---

*Integrations analysis: 2026-04-25*
*Update when new external services are connected*
