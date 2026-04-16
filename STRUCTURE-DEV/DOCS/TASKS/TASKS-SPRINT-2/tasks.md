# Tasks — Sprint 2 — Team Access + Onboarding + Audit Baseline

> Спринт: 2
> Даты: 15–28 апреля 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T2-01 | Реализовать invites API: create/list/resend/revoke/accept | P0 | 10h | TODO |
| T2-02 | Реализовать role change и remove membership с last-owner guard | P0 | 8h | TODO |
| T2-03 | Реализовать onboarding state API и step progress API | P0 | 8h | TODO |
| T2-04 | Реализовать auto-complete onboarding step по доменным событиям | P1 | 5h | TODO |
| T2-05 | Реализовать audit service write API и query list/drilldown baseline | P0 | 10h | TODO |
| T2-06 | Подключить audit hooks в auth/tenant/team/onboarding | P0 | 6h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T2-10 | Собрать UI списка команды, invites и роли | P0 | 12h | TODO |
| T2-11 | Собрать onboarding checklist/wizard с resume state | P0 | 10h | TODO |
| T2-12 | Добавить audit screen baseline для owner/support scope | P1 | 6h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T2-20 | Создать таблицы `invitations`, `onboarding_state`, `onboarding_step_progress` | P0 | 4h | TODO |
| T2-21 | Создать таблицы `audit_logs`/`audit_records` и индексы поиска | P0 | 5h | TODO |
| T2-22 | Добавить статусы и индексы membership/invite lifecycle | P1 | 3h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T2-30 | Подготовить конфиг retention для audit и invite TTL | P1 | 2h | TODO |
| T2-31 | Настроить email template delivery для invites | P1 | 3h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T2-40 | Протестировать invite lifecycle и accept flow | P0 | 5h | TODO |
| T2-41 | Протестировать role matrix и last-owner guard | P0 | 4h | TODO |
| T2-42 | Протестировать resume onboarding и auto-complete | P0 | 4h | TODO |
| T2-43 | Проверить audit immutability и RBAC visibility baseline | P1 | 4h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 47 | |
| Frontend | 28 | |
| БД | 12 | |
| Инфра | 5 | |
| Тестирование | 17 | |
| **Итого** | **109** | |
