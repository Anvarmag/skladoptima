# Sprint 6 — Orders + Inventory Core — Обзор

> Даты: 10–23 июня 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Построить доменную модель заказов и базовый inventory engine с reserve/release/deduct.

---

## Цель спринта

После спринта система должна уметь принимать нормализованные заказы, хранить их state/history, вычислять stock side-effects и показывать управляемый inventory balance в tenant scope.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 10. Заказы | [10-orders](../../BUSINESS-REQUIREMENTS/10-orders/requirements.md) | [10-orders](../../SYSTEM-ANALYTICS/10-orders/system-analytics.md) |
| 06. Остатки / Inventory | [06-inventory](../../BUSINESS-REQUIREMENTS/06-inventory/requirements.md) | [06-inventory](../../SYSTEM-ANALYTICS/06-inventory/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Orders ingestion и внутренняя state machine заказа
- [ ] Order items, duplicate/out-of-order handling
- [ ] Inventory balances/movements/reserved/available
- [ ] Reserve/release/deduct flows через доменные события
- [ ] Orders/Inventory UI baseline и operational screens

---

## Что НЕ входит в спринт

- advanced low-stock notifications
- финансовые расчеты и ABC
- billing, referrals, landing

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Двойные stock side-effects | Med | High | Идемпотентность на business-effect level |
| Непрозрачный status mapping order | Med | High | Отдельная internal state machine |
| Race conditions на reserve | Med | High | Транзакционные правила и lock policy |

---

## Зависимости

- Sprint 3 catalog mappings
- Sprint 4 warehouse references
- Sprint 5 sync engine и worker runtime

---

## Ссылки

- Задачи: [TASKS-SPRINT-6](../../TASKS/TASKS-SPRINT-6/tasks.md)
- Детальный план: [PLAN-SPRINT-6](../../PLAN/PLAN-SPRINT-6.md)
