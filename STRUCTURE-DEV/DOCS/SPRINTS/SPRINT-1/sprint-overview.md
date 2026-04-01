# Sprint 1 — Auth Fix + DB Tech Debt — Обзор

> Даты: 1–14 апреля 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Починить авторизацию и убрать критический технический долг в БД

---

## Цель спринта

Переход от `storeId` к `tenantId+membershipId` в JWT, устранение runtime ALTER TABLE, добавление индексов. После этого спринта — платформа готова к следующим фичам без накопленного долга.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований |
|--------|----------------|
| Авторизация | [01-auth](../../BUSINESS-REQUIREMENTS/01-auth/requirements.md) |
| Мультитенантность | [02-tenant](../../BUSINESS-REQUIREMENTS/02-tenant/requirements.md) |

---

## Ключевые deliverables

- [ ] JWT содержит userId, tenantId, membershipId, role (не storeId)
- [ ] Все runtime ALTER TABLE убраны, колонки в schema.prisma
- [ ] Индексы по tenantId на всех tenant-scoped таблицах
- [ ] Prisma migrate — полная история миграций

---

## Что НЕ входит в спринт

- UI управления командой
- Биллинг
- Worker

---

## Ссылки

- Задачи: [TASKS-SPRINT-1](../../TASKS/TASKS-SPRINT-1/tasks.md)
- Детальный план: [PLAN-SPRINT-1](../../PLAN/PLAN-SPRINT-1.md)
