# Sprint 2 — Team Access + Onboarding + Audit Baseline — Обзор

> Даты: 15–28 апреля 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Ввести командную модель, onboarding state и базовый audit trail для критичных действий.

---

## Цель спринта

После спринта пользователь сможет приглашать людей в tenant, управлять ролями, проходить onboarding с resume-state, а система будет писать базовый immutable audit по критичным операциям.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 03. Управление командой | [03-team](../../BUSINESS-REQUIREMENTS/03-team/requirements.md) | [03-team](../../SYSTEM-ANALYTICS/03-team/system-analytics.md) |
| 04. Онбординг | [04-onboarding](../../BUSINESS-REQUIREMENTS/04-onboarding/requirements.md) | [04-onboarding](../../SYSTEM-ANALYTICS/04-onboarding/system-analytics.md) |
| 16. Аудит и история | [16-audit](../../BUSINESS-REQUIREMENTS/16-audit/requirements.md) | [16-audit](../../SYSTEM-ANALYTICS/16-audit/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Invite lifecycle: create, resend, accept, expire, revoke
- [ ] Membership roles и role change policy с last-owner guard
- [ ] Onboarding state/store, step progress, auto-complete по событиям
- [ ] Audit write-path для team/onboarding/auth/tenant действий
- [ ] Базовый UI для команды и onboarding checklist

---

## Что НЕ входит в спринт

- каталог и import товаров
- billing и plan limits
- sync/worker инфраструктура

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Размытая модель ролей | Med | High | Зафиксировать RBAC matrix до старта API |
| Потеря onboarding progress | Med | High | Backend как единственный source of truth |
| Неполный audit coverage | Med | High | Каталог критичных действий и write contract |

---

## Зависимости

- Sprint 1: auth + tenant context
- Email delivery для invite flows
- Утвержденная матрица ролей и список audit-событий

---

## Ссылки

- Задачи: [TASKS-SPRINT-2](../../TASKS/TASKS-SPRINT-2/tasks.md)
- Детальный план: [PLAN-SPRINT-2](../../PLAN/PLAN-SPRINT-2.md)
