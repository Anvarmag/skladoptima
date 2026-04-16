# Sprint 8 — Finance + Product Analytics — Обзор

> Даты: 8–21 июля 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Построить управленческие витрины по прибыли и продажам на основе read-model и snapshot strategy.

---

## Цель спринта

Собрать unit economics и analytics layer как отдельные read-model: finance snapshots, sales aggregates, ABC, recommendations и export/drill-down сценарии.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 11. Юнит-экономика | [11-finance](../../BUSINESS-REQUIREMENTS/11-finance/requirements.md) | [11-finance](../../SYSTEM-ANALYTICS/11-finance/system-analytics.md) |
| 12. Аналитика (ABC) | [12-analytics](../../BUSINESS-REQUIREMENTS/12-analytics/requirements.md) | [12-analytics](../../SYSTEM-ANALYTICS/12-analytics/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Cost profile и finance snapshots по SKU/period
- [ ] Warning model для incomplete financial data
- [ ] Analytics read-model: KPI cards, trends, ABC groups, drill-down
- [ ] Rule-based recommendations и export baseline
- [ ] UI финансовой и продуктовой аналитики

---

## Что НЕ входит в спринт

- billing и payment processing
- referrals/promo
- маркетинговый landing и admin panel

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Неповторимые расчеты по разным формулам | Med | High | Formula versioning и snapshot strategy |
| Тяжелые аналитические запросы к OLTP | High | High | Только read-model/materialized aggregates |
| Неполные данные будут скрываться | Med | High | Warning state вместо silent zero |

---

## Зависимости

- Sprint 3 catalog
- Sprint 6 orders/inventory
- Sprint 7 audit/worker/notification observability как supporting layer

---

## Ссылки

- Задачи: [TASKS-SPRINT-8](../../TASKS/TASKS-SPRINT-8/tasks.md)
- Детальный план: [PLAN-SPRINT-8](../../PLAN/PLAN-SPRINT-8.md)
