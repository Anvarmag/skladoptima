# Tasks — Sprint 10 — Growth Layer: Referrals + Landing + Admin Panel

> Спринт: 10
> Даты: 5–18 августа 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T10-01 | Реализовать referral link/code generation и attribution flow | P0 | 8h | TODO |
| T10-02 | Реализовать promo validation/apply/redemption flow | P0 | 8h | TODO |
| T10-03 | Реализовать reward ledger и first-paid reward logic | P0 | 8h | TODO |
| T10-04 | Реализовать landing lead/CTA/consent backend handoff | P0 | 8h | TODO |
| T10-05 | Реализовать admin panel API: tenant 360, notes, support actions | P0 | 12h | TODO |
| T10-06 | Реализовать admin guardrails и domain-service contracts для high-risk actions | P0 | 6h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T10-10 | Собрать landing page, CTA blocks, lead/demo forms, legal blocks | P0 | 14h | TODO |
| T10-11 | Собрать UI referral center и promo apply flows | P0 | 8h | TODO |
| T10-12 | Собрать admin panel: tenant search, tenant 360, notes, support actions | P0 | 12h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T10-20 | Создать таблицы `referrals`, `promo_codes`, `promo_redemptions`, `reward_ledger` | P0 | 5h | TODO |
| T10-21 | Создать таблицы `leads`, `consent_records`, `admin_notes`, `support_actions` | P0 | 5h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T10-30 | Настроить landing env, attribution persistence и CRM/webhook integration baseline | P1 | 4h | TODO |
| T10-31 | Настроить alerting по reward failures, lead delivery failures и high-risk admin actions | P1 | 4h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T10-40 | Проверить referral attribution и anti-fraud rules | P0 | 5h | TODO |
| T10-41 | Проверить promo validation/redeem и reward credit idempotency | P0 | 5h | TODO |
| T10-42 | Проверить landing consent/lead/auth handoff | P0 | 4h | TODO |
| T10-43 | Проверить admin RBAC, audit trail и high-risk actions | P0 | 6h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 50 | |
| Frontend | 34 | |
| БД | 10 | |
| Инфра | 8 | |
| Тестирование | 20 | |
| **Итого** | **122** | |
