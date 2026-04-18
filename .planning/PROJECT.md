# SkladOptima

## What This Is

SkladOptima — multi-tenant SaaS-платформа для селлеров на маркетплейсах Wildberries и Ozon. Продукт решает 4 задачи: учёт товаров и складских остатков, синхронизация с маркетплейсами, юнит-экономика и финансовый учёт, аудит действий пользователей. Целевая аудитория — небольшие и средние команды селлеров с несколькими аккаунтами на маркетплейсах.

## Core Value

Селлер видит реальные остатки и знает, зарабатывает ли он — данные актуальны, потому что синхронизированы с маркетплейсами автоматически.

## Requirements

### Validated

(Работает в текущем MVP, но с техническим долгом)

- ✓ Авторизация (auth, JWT, сессии) — MVP, P0-долг
- ✓ Каталог товаров — работает
- ✓ Остатки/Inventory — работает, нет истории
- ✓ Маркетплейс-аккаунты (WB/Ozon) — работает
- ✓ Синхронизация с маркетплейсами — работает, нужен Worker
- ✓ Заказы — работает
- ✓ Юнит-экономика / Finance — работает
- ✓ Аналитика (ABC) — работает

### Active

Чистый переписанный продукт в `STRUCTURE-DEV/NEW/` — 10 спринтов (Q2–Q3 2026):

- [ ] Sprint 1: Auth + Tenant Core (greenfield foundation)
- [ ] Sprint 2: Team Access + Onboarding + Audit Baseline
- [ ] Sprint 3: Catalog Core + Files Storage (S3)
- [ ] Sprint 4: Marketplace Connections + Warehouses
- [ ] Sprint 5: Worker Platform + Sync Engine
- [ ] Sprint 6: Orders + Inventory Core
- [ ] Sprint 7: Inventory Hardening + Notifications + Audit Search
- [ ] Sprint 8: Finance + Product Analytics
- [ ] Sprint 9: Billing + Limits + Access States
- [ ] Sprint 10: Growth Layer: Referrals + Landing + Admin Panel

### Out of Scope

- Переход на другой CSS-фреймворк — стек зафиксирован в RULES.md
- Redux/Zustand — используется React state/context
- Local disk storage для файлов — только S3
- Raw SQL / `$executeRawUnsafe` — только Prisma migrations
- Мобильное приложение — веб-платформа

## Context

- **Существующий MVP**: работает частично, но содержит архитектурные проблемы (неправильная tenant isolation, файлы на диске, P0-долг в auth). Переписывается с нуля в `STRUCTURE-DEV/NEW/`.
- **Документация**: детальные требования, аналитика и системная аналитика по 20 разделам продукта — всё в `STRUCTURE-DEV/DOCS/`.
- **Рабочий процесс**: спринты по 2 недели, каждый спринт имеет `sprint-overview.md`, `tasks.md`, `PLAN-SPRINT-N.md` с чекбоксами.
- **Жизненный цикл задачи**: BUSINESS-REQUIREMENTS → ANALYTICS → PLAN → TASKS → Разработка → обновление PLAN с результатами.

## Constraints

- **Tech Stack**: NestJS 11, Prisma 5, PostgreSQL, React 19 + Vite 7, TailwindCSS 4, React Router 7, Recharts, Redis, S3, Docker Compose — не менять без обсуждения
- **Architecture**: FSD на фронтенде (`app/pages/widgets/features/entities/shared`), модульная структура на бэкенде
- **Security**: Tenant isolation обязательна на каждом запросе; JWT содержит `userId, tenantId, membershipId, role, sessionId`
- **Sprint cadence**: 2-недельные спринты, не добавлять задачи в середине без обновления PLAN
- **Language**: все тексты интерфейса на русском

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Переписать с нуля в NEW/ вместо патчить MVP | MVP имеет системные проблемы с tenant isolation и архитектурой | — Pending |
| FSD-архитектура на фронтенде | Чёткие границы слоёв, масштабируется при 20+ разделах | — Pending |
| httpOnly cookies для JWT | Защита от XSS, токены не доступны из JS | — Pending |
| S3 вместо local disk | Масштабируемость, не зависит от app-сервера | — Pending |

## Evolution

Этот документ обновляется на каждом переходе между спринтами и после завершения milestone.

**После каждого спринта:**
1. Требования выполнены? → Move to Validated с номером спринта
2. Новые требования появились? → Add to Active
3. Решения зафиксированы? → Add to Key Decisions
4. "What This Is" всё ещё актуально? → Update если дрейфовало

---
*Last updated: 2026-04-18 после инициализации проекта*
