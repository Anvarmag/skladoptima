# SkladOptima — Структура разработки (STRUCTURE-DEV)

> Единая точка входа в документацию продукта.
> Правила: [RULES.md](RULES.md) — читать обязательно перед стартом.

---

## Навигация

| Раздел | Что внутри | Ссылка |
|--------|-----------|--------|
| RULES | Правила разработки, стек, запреты | [RULES.md](RULES.md) |
| BUSINESS-REQUIREMENTS | Бизнес-требования по 20 разделам | [→](DOCS/BUSINESS-REQUIREMENTS/) |
| ANALYTICS | Метрики и аналитика по разделам | [→](DOCS/ANALYTICS/) |
| SYSTEM-ANALYTICS | Техническая аналитика для разработки по 20 разделам | [→](DOCS/SYSTEM-ANALYTICS/INDEX.md) |
| SPRINTS | Обзоры спринтов | [→](DOCS/SPRINTS/) |
| TASKS | Задачи разработки по спринтам | [→](DOCS/TASKS/) |
| PLAN | Детальные планы с чекбоксами | [→](DOCS/PLAN/) |

---

## 20 разделов продукта

| # | Раздел | Требования | Аналитика | Системная аналитика | Статус |
|---|--------|-----------|----------|---------------------|--------|
| 01 | Авторизация | [→](DOCS/BUSINESS-REQUIREMENTS/01-auth/requirements.md) | [→](DOCS/ANALYTICS/01-auth/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/01-auth/system-analytics.md) | Работает, P0-долг |
| 02 | Мультитенантность | [→](DOCS/BUSINESS-REQUIREMENTS/02-tenant/requirements.md) | [→](DOCS/ANALYTICS/02-tenant/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/02-tenant/system-analytics.md) | Частично |
| 03 | Управление командой | [→](DOCS/BUSINESS-REQUIREMENTS/03-team/requirements.md) | [→](DOCS/ANALYTICS/03-team/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/03-team/system-analytics.md) | UI отсутствует |
| 04 | Онбординг | [→](DOCS/BUSINESS-REQUIREMENTS/04-onboarding/requirements.md) | [→](DOCS/ANALYTICS/04-onboarding/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/04-onboarding/system-analytics.md) | Отсутствует |
| 05 | Каталог товаров | [→](DOCS/BUSINESS-REQUIREMENTS/05-catalog/requirements.md) | [→](DOCS/ANALYTICS/05-catalog/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/05-catalog/system-analytics.md) | Работает |
| 06 | Остатки / Inventory | [→](DOCS/BUSINESS-REQUIREMENTS/06-inventory/requirements.md) | [→](DOCS/ANALYTICS/06-inventory/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/06-inventory/system-analytics.md) | Работает, нет истории |
| 07 | Склады | [→](DOCS/BUSINESS-REQUIREMENTS/07-warehouses/requirements.md) | [→](DOCS/ANALYTICS/07-warehouses/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/07-warehouses/system-analytics.md) | Минимально |
| 08 | Маркетплейс-аккаунты | [→](DOCS/BUSINESS-REQUIREMENTS/08-marketplace-accounts/requirements.md) | [→](DOCS/ANALYTICS/08-marketplace-accounts/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/08-marketplace-accounts/system-analytics.md) | Работает |
| 09 | Синхронизация | [→](DOCS/BUSINESS-REQUIREMENTS/09-sync/requirements.md) | [→](DOCS/ANALYTICS/09-sync/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/09-sync/system-analytics.md) | Работает, нужен Worker |
| 10 | Заказы | [→](DOCS/BUSINESS-REQUIREMENTS/10-orders/requirements.md) | [→](DOCS/ANALYTICS/10-orders/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/10-orders/system-analytics.md) | Работает |
| 11 | Юнит-экономика | [→](DOCS/BUSINESS-REQUIREMENTS/11-finance/requirements.md) | [→](DOCS/ANALYTICS/11-finance/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/11-finance/system-analytics.md) | Работает |
| 12 | Аналитика (ABC) | [→](DOCS/BUSINESS-REQUIREMENTS/12-analytics/requirements.md) | [→](DOCS/ANALYTICS/12-analytics/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/12-analytics/system-analytics.md) | Работает |
| 13 | Биллинг | [→](DOCS/BUSINESS-REQUIREMENTS/13-billing/requirements.md) | [→](DOCS/ANALYTICS/13-billing/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/13-billing/system-analytics.md) | Отсутствует |
| 14 | Рефералы и промо | [→](DOCS/BUSINESS-REQUIREMENTS/14-referrals/requirements.md) | [→](DOCS/ANALYTICS/14-referrals/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/14-referrals/system-analytics.md) | Отсутствует |
| 15 | Уведомления | [→](DOCS/BUSINESS-REQUIREMENTS/15-notifications/requirements.md) | [→](DOCS/ANALYTICS/15-notifications/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/15-notifications/system-analytics.md) | Отсутствует |
| 16 | Аудит и история | [→](DOCS/BUSINESS-REQUIREMENTS/16-audit/requirements.md) | [→](DOCS/ANALYTICS/16-audit/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/16-audit/system-analytics.md) | Минимально |
| 17 | Файлы / S3 | [→](DOCS/BUSINESS-REQUIREMENTS/17-files-s3/requirements.md) | [→](DOCS/ANALYTICS/17-files-s3/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/17-files-s3/system-analytics.md) | Проблема (local disk) |
| 18 | Worker | [→](DOCS/BUSINESS-REQUIREMENTS/18-worker/requirements.md) | [→](DOCS/ANALYTICS/18-worker/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/18-worker/system-analytics.md) | Отсутствует |
| 19 | Admin-панель | [→](DOCS/BUSINESS-REQUIREMENTS/19-admin/requirements.md) | [→](DOCS/ANALYTICS/19-admin/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/19-admin/system-analytics.md) | Отсутствует |
| 20 | Лендинг | [→](DOCS/BUSINESS-REQUIREMENTS/20-landing/requirements.md) | [→](DOCS/ANALYTICS/20-landing/analytics.md) | [→](DOCS/SYSTEM-ANALYTICS/20-landing/system-analytics.md) | Отсутствует |

---

## Спринты Q2–Q3 2026

| Спринт | Название | Даты | Обзор | Tasks | Plan |
|--------|---------|------|-------|-------|------|
| Sprint 1 | Foundation: Auth + Tenant Core | 1–14 апр | [→](DOCS/SPRINTS/SPRINT-1/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-1/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-1.md) |
| Sprint 2 | Team Access + Onboarding + Audit Baseline | 15–28 апр | [→](DOCS/SPRINTS/SPRINT-2/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-2/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-2.md) |
| Sprint 3 | Catalog Core + Files Storage | 29 апр – 12 май | [→](DOCS/SPRINTS/SPRINT-3/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-3/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-3.md) |
| Sprint 4 | Marketplace Connections + Warehouses | 13–26 май | [→](DOCS/SPRINTS/SPRINT-4/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-4/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-4.md) |
| Sprint 5 | Worker Platform + Sync Engine | 27 май – 9 июн | [→](DOCS/SPRINTS/SPRINT-5/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-5/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-5.md) |
| Sprint 6 | Orders + Inventory Core | 10–23 июн | [→](DOCS/SPRINTS/SPRINT-6/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-6/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-6.md) |
| Sprint 7 | Inventory Hardening + Notifications + Audit Search | 24 июн – 7 июл | [→](DOCS/SPRINTS/SPRINT-7/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-7/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-7.md) |
| Sprint 8 | Finance + Product Analytics | 8–21 июл | [→](DOCS/SPRINTS/SPRINT-8/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-8/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-8.md) |
| Sprint 9 | Billing + Limits + Access States | 22 июл – 4 авг | [→](DOCS/SPRINTS/SPRINT-9/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-9/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-9.md) |
| Sprint 10 | Growth Layer: Referrals + Landing + Admin Panel | 5–18 авг | [→](DOCS/SPRINTS/SPRINT-10/sprint-overview.md) | [→](DOCS/TASKS/TASKS-SPRINT-10/tasks.md) | [→](DOCS/PLAN/PLAN-SPRINT-10.md) |

---

## Как работать с этой структурой

### Стартуя новый раздел

1. Открыть `BUSINESS-REQUIREMENTS/XX-name/requirements.md`
2. Заполнить User Stories, FR, бизнес-правила
3. Открыть `ANALYTICS/XX-name/analytics.md` — заполнить KPI и события
4. Открыть `DOCS/SYSTEM-ANALYTICS/XX-name/system-analytics.md` — зафиксировать API, БД и шаги реализации
5. Только после этого — переходить к спринту

### Стартуя новый спринт

1. Открыть `SPRINTS/SPRINT-N/sprint-overview.md` — уточнить цель и scope
2. Заполнить `TASKS/TASKS-SPRINT-N/tasks.md` — конкретные dev-задачи с оценкой
3. Перенести задачи в `PLAN/PLAN-SPRINT-N.md` — разбить по этапам с чекбоксами
4. В ходе спринта — отмечать чекбоксы и писать "Что именно сделано"
5. По итогу — заполнить "Итоги спринта"

### Шаблоны

- Требования: [_TEMPLATE.md](DOCS/BUSINESS-REQUIREMENTS/_TEMPLATE.md)
- Аналитика: [_TEMPLATE.md](DOCS/ANALYTICS/_TEMPLATE.md)
- Системная аналитика: [_TEMPLATE.md](DOCS/SYSTEM-ANALYTICS/_TEMPLATE.md)
- Обзор спринта: [_TEMPLATE.md](DOCS/SPRINTS/_TEMPLATE.md)
- Tasks: [_TEMPLATE.md](DOCS/TASKS/_TEMPLATE.md)
- Plan: [_TEMPLATE.md](DOCS/PLAN/_TEMPLATE.md)
