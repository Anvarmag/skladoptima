# Онбординг — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Оценить, насколько онбординг ускоряет переход нового пользователя к реальной ценности: создание tenant, подключение маркетплейса, первый sync. Основное решение на данных: какие шаги помогают активации, а какие создают фрикцию.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Onboarding Start Rate | Доля новых пользователей, открывших onboarding | >= 90% | `onboarding_opened / new_verified_users` |
| Onboarding Completion Rate | Доля завершивших onboarding | >= 65% | `onboarding_completed / onboarding_opened` |
| Skip Rate | Доля пользователей, пропустивших onboarding | <= 30% | `onboarding_skipped_or_closed / onboarding_opened` |
| Time to First Integration | Время до первого подключения маркетплейса | <= 24ч p50 | `median(first_integration_at - onboarding_opened_at)` |
| Time to First Sync | Время до первого успешного sync | <= 48ч p50 | `median(first_sync_success_at - onboarding_opened_at)` |

---

## 3. Воронки и конверсии

```
Onboarding opened -> Step viewed -> Integration CTA clicked -> Marketplace connected -> First sync success
100%              -> 82%        -> 58%                   -> 44%                   -> 35%
```

Альтернативный путь (skip):

```
Onboarding opened -> Onboarding skipped -> Integration connected in 7d
100%              -> 25%                -> 18%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Новый Owner без опыта | Проходит шаги последовательно | Четкая структура и простые пояснения |
| Опытный пользователь | Часто использует skip | Быстрый переход к рабочему экрану |
| Пользователь с инвайтом | Меньше интерес к базовым подсказкам | Контекстно-ролевой onboarding |
| Неактивированный tenant | Застревает до интеграции | Сильный CTA на подключение и помощь |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `onboarding_opened` | Открыт onboarding | `entrypoint`, `tenant_state` | High |
| `onboarding_step_viewed` | Просмотр шага | `step_id`, `step_order` | High |
| `onboarding_step_skipped` | Пропуск шага | `step_id`, `reason` | Med |
| `onboarding_closed` | Закрытие onboarding | `close_method=skip/close` | High |
| `onboarding_completed` | Завершен onboarding | `steps_completed_count` | High |
| `onboarding_reopened` | Повторно открыт onboarding | `source=settings/help` | Med |
| `integration_cta_clicked` | Клик на подключение интеграции | `target_marketplace` | High |
| `support_cta_clicked` | Клик на поддержку | `channel` | Med |

---

## 6. Текущее состояние (baseline)

- По BRD onboarding должен быть повторно доступен; baseline повторных открытий пока отсутствует.
- MVP предполагает отсутствие демо-данных, поэтому важно измерять скорость перехода к реальным данным.
- Рекомендуемый стартовый baseline период: первые 2 спринта после релиза onboarding UI.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Прогресс-бар с явной ценностью шага повысит completion | `Onboarding Completion Rate` | Идея |
| Кнопка «подключить позже» с напоминанием в 24ч снизит полный drop | `Time to First Integration` | Идея |
| Встроенный блок «связаться с поддержкой» на проблемных шагах снизит abandon | `onboarding_closed_without_integration` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Onboarding Funnel: вход, шаги, completion, skip.
- [ ] Activation Dashboard: `first integration`, `first sync`, время до ценности.
- [ ] Step Diagnostics: проблемные шаги с максимальным drop.
- [ ] Support in Onboarding: где и когда пользователи зовут поддержку.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Высокий skip rate | `> 40%` | Пересмотреть длину сценария и текст шагов |
| Низкий переход к интеграции | `< 35%` | Усилить CTA и добавить contextual help |
| Долгое время до первого sync | `p50 > 72ч` | Проверить связку onboarding -> marketplace setup -> sync |
| Рост повторных открытий без completion | `> 25%` | Выявить шаги с непонятной формулировкой |

---

## 11. Источники данных и правила расчета

- Основной источник: `onboarding_state`, `onboarding_step_progress`, product events `integration connected`, `first sync success`.
- `Time to First Integration` считается от `onboarding_opened_at`, а не от регистрации, чтобы не смешивать auth churn и onboarding churn.
- Пользователи с invite-flow и пользователи с create-tenant-flow должны анализироваться отдельно.
- Skip rate нужно считать и по целому onboarding, и по каждому step key.

---

## 12. Data Quality и QA-проверки

- `onboarding_completed` не должен отправляться до `onboarding_started`.
- Повторное открытие не должно затирать историю прошлых step statuses.
- QA должна проверить resume после relogin, skip отдельного шага, full close, reopen после complete, пользователя без интеграций.
- События CTA `support` и `integration` должны иметь `step_key` и `entrypoint`.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: activation до first integration и first sync.
- UX/Frontend owner: drop-off по шагам и skip behavior.
- QA: continuity между сессиями и edge-cases reopen/close.
- Data review: 2 раза в неделю на период запуска onboarding, дальше еженедельно.

---

## 14. Зависимости, допущения и границы

- Onboarding измеряет активацию, а не просто просмотр экранов; ключевая ценность наступает после подключения интеграции и первого полезного результата.
- Пользователь может прервать поток и вернуться позже, поэтому аналитика обязана поддерживать resume-state, а не только линейную сессию.
- Onboarding для owner/admin и приглашенного участника не идентичен и должен оцениваться раздельно.
- Пропуск шага не всегда является негативом: часть шагов может быть необязательной, но это должно быть явно отражено в модели.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
