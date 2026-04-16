# Admin-панель — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять эффективность внутренней поддержки tenant через admin-панель: скорость диагностики, результативность support actions и соблюдение безопасных процедур (reason/comment + audit). Раздел нужен для контроля качества операционной поддержки платформы.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Tenant Case Resolution Time | Время до первичного решения проблемы tenant | <= 30 мин p50 | `median(case_resolved_at - case_opened_at)` |
| Support Action Success Rate | Доля support-действий, завершившихся целевым результатом | >= 90% | `successful_support_actions / support_actions_total` |
| High-Risk Actions with Reason | Действия с обязательным обоснованием | >= 99% | `high_risk_with_reason / high_risk_actions_total` |
| Repeat Case Rate | Повторные обращения по тому же tenant за 7 дней | <= 20% | `repeat_cases_7d / total_cases` |
| Tenant Recovery Rate | Доля tenant, восстановленных после support-интервенции | >= 70% | `tenants_recovered / tenants_with_support_action` |
| Audit Compliance Rate | Support-действия, корректно попавшие в audit | 100% | `audited_support_actions / support_actions_total` |

---

## 3. Воронки и конверсии

```
Tenant найден -> Диагностика открыта -> Support action выполнен -> Tenant recovered -> Case closed
100%         -> 92%                -> 80%                    -> 70%              -> 65%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| SUPPORT_ADMIN | Основной оператор панели | Быстрые фильтры и безопасные action-flow |
| Support lead | Контроль качества операций | Отчеты по SLA и повторным обращениям |
| Sales/Success (внутренние) | Нужен контекст по tenant | Просмотр ключевого статуса без risk actions |
| Tenant с recurring incidents | Частые кейсы по интеграциям/доступу | Системная диагностика и заметки handoff |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `admin_tenant_search_performed` | Выполнен поиск tenant | `query_type=name/email/id` | Med |
| `admin_tenant_card_opened` | Открыта карточка tenant | `tenant_id`, `actor_id` | High |
| `admin_support_action_started` | Инициировано support-действие | `action_type`, `risk_level` | High |
| `admin_support_action_completed` | Действие завершено | `action_type`, `result` | High |
| `admin_support_action_rejected` | Действие отклонено валидацией | `action_type`, `reject_reason` | High |
| `admin_reason_comment_missing` | Попытка high-risk без комментария | `action_type` | High |
| `admin_internal_note_created` | Добавлена support note | `tenant_id`, `note_type` | Med |
| `admin_password_reset_initiated` | Запущен password reset flow | `target_user_id`, `actor_id` | High |
| `admin_access_state_changed` | Изменен access state tenant | `from_state`, `to_state`, `reason` | High |
| `admin_special_free_assigned` | Назначен special free access | `tenant_id`, `reason` | High |

---

## 6. Текущее состояние (baseline)

- Admin-панель в roadmap как отсутствующая, baseline потребуется формировать с запуска.
- Ключевой baseline: скорость диагностики tenant и качество логирования support actions.
- Отдельно нужен baseline по повторным обращениям и причинам повторных кейсов.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Быстрые пресеты фильтров “проблемные tenant” сократят время диагностики | `Tenant Case Resolution Time` | Идея |
| Шаблоны reason/comment для high-risk действий повысят audit-compliance | `High-Risk Actions with Reason` | Идея |
| Карточка tenant 360 с последними ошибками sync/billing снизит repeat cases | `Repeat Case Rate` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Support SLA Dashboard: скорость реакции и закрытия кейсов.
- [ ] Support Actions Quality: success/fail/reject по типам действий.
- [ ] Audit Compliance Report: high-risk операции и комментарии.
- [ ] Tenant Recovery Report: восстановление после вмешательства support.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Рост repeat cases | `> 30%` | Разобрать первопричины и улучшить runbook |
| High-risk действия без reason | Любой случай | Блокирующий контроль в UI и аудит |
| Низкий success у support actions | `< 80%` | Пересмотреть права, инструкции, UX формы |
| Долгое время до диагностики | `p50 > 60 мин` | Усилить фильтры и алерты по проблемным tenant |

---

## 11. Источники данных и правила расчета

- Источники: admin action logs, support cases/notes, tenant health summary, audit records, access-state changes.
- Support action success должен считаться по ожидаемому результату действия, а не только по техническому завершению формы.
- Repeat case rate требует связи кейсов по tenant и проблемной категории, иначе метрика будет шумной.
- Tenant recovery должен иметь явный критерий: восстановлен доступ, завершен sync, устранен billing block или снята другая первопричина.

---

## 12. Data Quality и QA-проверки

- QA должна проверить поиск tenant, просмотр карточки, restricted-access read-only views, high-risk actions с reason/comment, rejected flows.
- Любое действие support обязано логироваться одновременно в operational history и audit trail.
- Внутренние заметки не должны утекать в tenant-facing интерфейсы и внешние API.
- Изменение access-state, special-free или password reset должно быть воспроизводимо по actor, reason и timestamp.

---

## 13. Владельцы метрик и ритм ревью

- Support/product owner: скорость решения кейсов и recovery rate.
- Backend/security lead: контроль high-risk действий, audit compliance, RBAC.
- QA: end-to-end сценарии support operations и защитные ограничения.
- Review cadence: ежедневный контроль high-risk операций, еженедельный разбор repeat cases и эффективности runbook.

---

## 14. Зависимости, допущения и границы

- Admin-панель не должна обходить доменные правила продукта; support может инициировать действия, но не ломать state machines модулей.
- Любая внутренняя операция с tenant-эффектом должна требовать reason и оставлять след в audit.
- Для sales/success ролей допустим только read-only доступ к tenant context без разрушительных действий.
- Карточка tenant 360 зависит от качества данных в auth, billing, sync, notifications и audit, поэтому нужны деградационные статусы источников.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
