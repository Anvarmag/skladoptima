# Tasks — Sprint 1 — Foundation: Auth + Tenant Core

> Спринт: 1
> Даты: 1–14 апреля 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T1-01 | Реализовать `POST /auth/register` + verification token flow | P0 | 6h | TODO |
| T1-02 | Реализовать `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | P0 | 8h | TODO |
| T1-03 | Реализовать forgot/reset/change password + revoke sessions | P0 | 8h | TODO |
| T1-04 | Ввести JWT payload с `tenantId`, `membershipId`, `role`, `sessionId` | P0 | 4h | TODO |
| T1-05 | Реализовать `POST /tenants`, `GET /tenants/my`, `POST /tenants/switch` | P0 | 8h | TODO |
| T1-06 | Реализовать tenant access-state read model и policy middleware | P1 | 5h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T1-10 | Собрать auth screens: register, login, verify email, reset password | P0 | 12h | TODO |
| T1-11 | Реализовать tenant selector после login и пустое состояние без tenant | P0 | 6h | TODO |
| T1-12 | Подключить guarded routing на основе JWT/session context | P1 | 4h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T1-20 | Создать таблицы `users`, `auth_sessions`, `email_verification_tokens`, `password_reset_tokens` | P0 | 4h | TODO |
| T1-21 | Создать таблицы `tenants`, `memberships`, `tenant_settings`, `auth_events` | P0 | 5h | TODO |
| T1-22 | Добавить индексы и уникальности для email, session, active membership, tenant scope | P0 | 3h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T1-30 | Настроить secrets для JWT и SMTP/email provider | P1 | 3h | TODO |
| T1-31 | Подготовить env-конфиг для TTL, rate limits и auth policy | P1 | 2h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T1-40 | Покрыть e2e: register -> verify -> login -> logout | P0 | 5h | TODO |
| T1-41 | Покрыть e2e: forgot -> reset -> login with new password | P0 | 4h | TODO |
| T1-42 | Проверить tenant isolation и switch context | P0 | 5h | TODO |
| T1-43 | Проверить revoke session и ошибки token expired/used | P1 | 3h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 39 | |
| Frontend | 22 | |
| БД | 12 | |
| Инфра | 5 | |
| Тестирование | 17 | |
| **Итого** | **95** | |
