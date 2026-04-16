# Sprint 1 — Foundation: Auth + Tenant Core — Обзор

> Даты: 1–14 апреля 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Ввести базовый auth-context и tenant isolation, на которых будут строиться все остальные модули.

---

## Цель спринта

Поднять greenfield foundation продукта: регистрация, login, session model, JWT claims, create/switch tenant, базовый access-state и tenant-scoped контекст для всех следующих модулей.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 01. Авторизация | [01-auth](../../BUSINESS-REQUIREMENTS/01-auth/requirements.md) | [01-auth](../../SYSTEM-ANALYTICS/01-auth/system-analytics.md) |
| 02. Мультитенантность | [02-tenant](../../BUSINESS-REQUIREMENTS/02-tenant/requirements.md) | [02-tenant](../../SYSTEM-ANALYTICS/02-tenant/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Полный auth API: register, verify, login, logout, me, forgot/reset/change password, sessions
- [ ] JWT с `userId`, `tenantId`, `membershipId`, `role`, `sessionId`
- [ ] Tenant create/switch/my/list/settings/access-state
- [ ] Базовые миграции users/sessions/tenants/memberships/tokens/events
- [ ] Security и tenant-isolation тестовый контур

---

## Что НЕ входит в спринт

- UI управления командой
- каталог, склады, заказы, sync
- биллинг, лимиты, growth-механики

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Ошибка в границе tenant scope | Med | High | Сразу закладывать claims + server-side policy checks |
| Слабая session/revoke модель | Med | High | Реализовать `auth_sessions` и revoke policy в Sprint 1 |
| Задержка email flow | Med | Med | Email отправка только асинхронно через event/job |

---

## Зависимости

- Утвержденные правила по JWT claims и tenant context
- Согласованная модель users / tenants / memberships
- Базовая среда для email delivery и secret management

---

## Ссылки

- Задачи: [TASKS-SPRINT-1](../../TASKS/TASKS-SPRINT-1/tasks.md)
- Детальный план: [PLAN-SPRINT-1](../../PLAN/PLAN-SPRINT-1.md)
