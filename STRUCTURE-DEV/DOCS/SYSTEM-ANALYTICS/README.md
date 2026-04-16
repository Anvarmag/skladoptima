# SYSTEM-ANALYTICS — Техническая спецификация (Greenfield)

> Назначение: единый слой системной аналитики для разработки каждого продуктового раздела.
> Основа: бизнес-требования и продуктовая аналитика из `STRUCTURE-DEV/DOCS/*`.
> Подход: проектирование с нуля (`to-be`), без привязки к текущей кодовой реализации.

## 1. Базовые API-правила

- Базовый префикс API: `/api/v1`
- Формат: JSON, `Content-Type: application/json`
- Аутентификация: `Authorization: Bearer <JWT>`
- Мультитенантность: `tenantId` берется из JWT claims, не из body/query
- Время: UTC ISO8601 (`2026-04-15T12:00:00Z`)
- Идемпотентность для внешних событий: заголовок `Idempotency-Key`

## 2. Единый формат ошибок

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Невалидный запрос",
    "details": [
      { "field": "email", "reason": "INVALID_FORMAT" }
    ],
    "requestId": "req_01HXYZ..."
  }
}
```

### Коды ошибок

- `VALIDATION_ERROR` — ошибка входных данных
- `UNAUTHORIZED` — нет валидного токена
- `FORBIDDEN` — недостаточно прав
- `NOT_FOUND` — сущность не найдена
- `CONFLICT` — конфликт состояния / дубль
- `RATE_LIMITED` — превышение лимита
- `EXTERNAL_INTEGRATION_ERROR` — ошибка внешнего API
- `INTERNAL_ERROR` — непредвиденная ошибка

## 3. Единый формат пагинации

```json
{
  "items": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "pages": 0
  }
}
```

## 4. Стандартные audit-поля для БД

Во всех таблицах, где применимо:

- `id UUID PK`
- `tenant_id UUID NOT NULL` (кроме глобальных служебных)
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `deleted_at TIMESTAMPTZ NULL` (для soft delete)

## 5. Стандарт индексов

- Индекс по `tenant_id` обязателен для tenant-scoped таблиц
- Для списков: композитные индексы `(tenant_id, created_at DESC)`
- Для уникальности: композитные уникальные ключи в tenant-контексте

## 6. Методика разработки по каждому модулю

1. Создать миграции под таблицы модуля.
2. Описать DTO/валидации и контракты API.
3. Реализовать сервисную бизнес-логику.
4. Покрыть сценарии интеграционными тестами.
5. Подключить audit-события и продуктовые events.
6. Добавить observability: метрики, алерты, дашборды.

