# Sprint 10 — Growth Layer: Referrals + Landing + Admin Panel — Обзор

> Даты: 5–18 августа 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Закрыть growth и internal operations слой: referral/promo, landing handoff и admin support panel.

---

## Цель спринта

После спринта продукт получает growth-механики привлечения, публичный acquisition слой и внутренний support-интерфейс для безопасного сопровождения tenant.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 14. Рефералы и промо | [14-referrals](../../BUSINESS-REQUIREMENTS/14-referrals/requirements.md) | [14-referrals](../../SYSTEM-ANALYTICS/14-referrals/system-analytics.md) |
| 19. Admin-панель | [19-admin](../../BUSINESS-REQUIREMENTS/19-admin/requirements.md) | [19-admin](../../SYSTEM-ANALYTICS/19-admin/system-analytics.md) |
| 20. Лендинг | [20-landing](../../BUSINESS-REQUIREMENTS/20-landing/requirements.md) | [20-landing](../../SYSTEM-ANALYTICS/20-landing/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Referral attribution, promo validation и reward ledger
- [ ] Public landing с CTA, attribution handoff и consent capture
- [ ] Admin panel: tenant 360, internal notes, support actions
- [ ] Связка referrals с billing first-paid event
- [ ] Support-safe internal tooling с audit и guardrails

---

## Что НЕ входит в спринт

- сложный CMS/marketing suite
- affiliate network beyond product referral
- полноценный helpdesk/CRM replacement

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Fraud в referral/promo | Med | High | Anti-fraud rules и idempotent rewarding |
| Admin panel станет обходом доменных правил | Med | High | Только через официальные service contracts |
| Потеря attribution/consent в landing handoff | Med | High | Persisted handoff context и consent records |

---

## Зависимости

- Sprint 9 billing events и payment success
- Sprint 7 audit/notifications baseline
- Sprint 1 auth foundation для landing -> registration handoff

---

## Ссылки

- Задачи: [TASKS-SPRINT-10](../../TASKS/TASKS-SPRINT-10/tasks.md)
- Детальный план: [PLAN-SPRINT-10](../../PLAN/PLAN-SPRINT-10.md)
