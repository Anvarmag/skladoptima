# Sprint 7 — Inventory Hardening + Notifications + Audit Search — Обзор

> Даты: 24 июня – 7 июля 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Довести inventory до операционного качества и добавить notification/audit diagnostics слой.

---

## Цель спринта

После спринта система должна уметь отслеживать low-stock и конфликты, доставлять критичные уведомления, а audit должен стать полноценным инструментом поиска и расследования инцидентов.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 06. Остатки / Inventory | [06-inventory](../../BUSINESS-REQUIREMENTS/06-inventory/requirements.md) | [06-inventory](../../SYSTEM-ANALYTICS/06-inventory/system-analytics.md) |
| 15. Уведомления | [15-notifications](../../BUSINESS-REQUIREMENTS/15-notifications/requirements.md) | [15-notifications](../../SYSTEM-ANALYTICS/15-notifications/system-analytics.md) |
| 16. Аудит и история | [16-audit](../../BUSINESS-REQUIREMENTS/16-audit/requirements.md) | [16-audit](../../SYSTEM-ANALYTICS/16-audit/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Low-stock rules, inventory conflicts view и operational alerts
- [ ] Notification event -> dispatch -> delivery pipeline
- [ ] In-app notifications и delivery status model baseline
- [ ] Audit search/drilldown с фильтрами по actor/entity/time
- [ ] Алерты и observability по stock, dispatch, audit failures

---

## Что НЕ входит в спринт

- marketing digest engine advanced
- referral/promo notifications
- финансовые dashboards

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Спам и дубли уведомлений | Med | Med | Dedup/throttle policy и event taxonomy |
| Audit поиск станет тяжелым | Med | Med | Индексы и query model до UI |
| Low-stock rules вызовут шум | Med | Med | Threshold policy и фильтрация по scope |

---

## Зависимости

- Sprint 2 audit baseline
- Sprint 5 worker runtime
- Sprint 6 inventory events

---

## Ссылки

- Задачи: [TASKS-SPRINT-7](../../TASKS/TASKS-SPRINT-7/tasks.md)
- Детальный план: [PLAN-SPRINT-7](../../PLAN/PLAN-SPRINT-7.md)
