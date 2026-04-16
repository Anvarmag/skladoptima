# Мультитенантность — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять создание tenant, качество изоляции данных и влияние состояний доступа (`TRIAL_ACTIVE`, `ACTIVE_PAID`, `GRACE_PERIOD`, `SUSPENDED`) на реальное использование продукта. Данные нужны для решений по активации, удержанию и правилам доступа.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Tenant Creation Rate | Доля пользователей без компании, создавших tenant | >= 65% | `users_created_tenant / users_without_tenant` |
| Multi-Tenant Adoption | Доля пользователей с 2+ tenant | 8-20% | `users_with_2plus_tenants / active_users` |
| Cross-Tenant Isolation Incidents | Инциденты нарушения tenant-изоляции | 0 | `count(isolation_incident)` |
| Suspended Reactivation Rate | Возврат tenant из `SUSPENDED` в оплату | >= 25% | `reactivated_from_suspended / suspended_tenants` |
| Tenant Setup Completion 7d | Tenant с базовой настройкой за 7 дней | >= 70% | `configured_tenants_7d / new_tenants` |

---

## 3. Воронки и конверсии

```
Пользователь без tenant -> Создание tenant -> Первичная настройка -> Подключение интеграции -> Первый sync
100%                    -> 65%             -> 55%                 -> 40%                    -> 32%
```

Воронка жизненного цикла доступа:

```
TRIAL_ACTIVE -> ACTIVE_PAID -> GRACE_PERIOD -> SUSPENDED -> REACTIVATED
100%         -> 35%         -> 12%          -> 8%        -> 2%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Solo-owner tenant | Быстрое создание, медленная настройка | Упрощенный setup + checklist |
| Multi-tenant operator | Частые переключения контекста | Надежный tenant-switch UX |
| Trial tenant | Высокая активность в первые 3-5 дней | Быстро довести до интеграции и sync |
| Suspended tenant | Заходит в read-only и уходит | Точные billing CTA и план восстановления |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `tenant_created` | Создан новый tenant | `tenant_id`, `creator_user_id`, `country` | High |
| `tenant_settings_updated` | Изменены настройки tenant | `changed_fields`, `actor_role` | Med |
| `tenant_access_state_changed` | Переход состояния доступа | `from_state`, `to_state`, `reason` | High |
| `tenant_subscription_state_changed` | Переход billing state | `from`, `to`, `plan` | High |
| `tenant_switched` | Пользователь переключил tenant | `from_tenant`, `to_tenant` | Med |
| `tenant_isolation_denied` | Попытка доступа к чужому tenant | `actor_id`, `resource`, `source` | High |
| `tenant_suspended_entered` | Tenant перешел в `SUSPENDED` | `has_grace`, `days_after_expiry` | High |
| `tenant_reactivated` | Tenant восстановил доступ | `payment_method`, `plan` | High |

---

## 6. Текущее состояние (baseline)

- Исторический baseline по состояниям access/subscription еще не формализован.
- Для MVP нужно отдельно снять baseline по времени до первого `connected marketplace`.
- Критично с первого дня отслеживать события отказа tenant-изоляции и доступа к чужим данным.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Чеклист настройки tenant после создания снизит drop-off в setup | `Tenant Setup Completion 7d` | Идея |
| Явный экран выбора tenant при 2+ membership снизит ошибки контекста | `tenant_switch_error_rate` | Идея |
| Pre-suspend серия напоминаний увеличит долю реактивации | `Suspended Reactivation Rate` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Tenant Lifecycle: создание, активация, состояние доступа, реактивации.
- [ ] Isolation Monitor: denied events, попытки cross-tenant доступа.
- [ ] Setup Velocity: время до первой интеграции и первого sync.
- [ ] Access-State Cohorts: конверсии trial -> paid -> retained.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Падение создания tenant после login | `< 45%` | Проверить onboarding/CTA и ошибки создания |
| Рост `tenant_isolation_denied` | `> 0.5% от активных сессий` | Срочный security review + блокирующий алерт |
| Резкий рост `SUSPENDED` | `> 15% tenant в неделю` | Проверить биллинг-коммуникации и платежные ошибки |
| Низкая реактивация | `< 15%` | Пересмотреть grace flow и предложение тарифа |

---

## 11. Источники данных и правила расчета

- Источник tenant lifecycle: таблицы `tenants`, `memberships`, `tenant_settings`, `subscription/access-state events`.
- Метрики создания tenant считаются по первому tenant на пользователя и отдельно по повторному созданию.
- Multi-tenant adoption нужно считать по уникальным активным user, а не по количеству memberships.
- Security-инциденты tenant isolation должны брать данные из deny-логов API/authorization layer, а не только из audit UI.

---

## 12. Data Quality и QA-проверки

- Любое tenant-scoped событие должно содержать `tenant_id`.
- `tenant_switched` должен всегда ссылаться на реальную active membership.
- QA должна проверить read-only режим в `SUSPENDED`, невозможность cross-tenant доступа по прямому `id`, корректность первого/последнего tenant selection.
- Значение `owner_user_id` и membership `OWNER` должны быть консистентны на старте tenant.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: activation до первого tenant и до первой интеграции.
- Backend lead: tenant isolation и access-state transitions.
- QA: tenant switch, suspended mode, membership guardrails.
- Data review: еженедельно по lifecycle cohort, немедленно при любом isolation incident.

---

## 14. Зависимости, допущения и границы

- Tenant является базовой границей изоляции данных, поэтому вся аналитика модуля должна быть tenant-aware по определению.
- Создание tenant, приглашение пользователей и подписка могут происходить в разные моменты времени; их нельзя сводить в одну точку жизненного цикла.
- Режимы `active`, `grace`, `suspended`, `read-only` должны считаться как разные операционные состояния, а не просто billing labels.
- Любой cross-tenant access incident считается security-дефектом независимо от того, был ли пользователь “почти авторизован”.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
